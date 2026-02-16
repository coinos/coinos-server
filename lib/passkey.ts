import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
} from "@simplewebauthn/types";
import { db, g, s } from "$lib/db";
import { fail, getUser } from "$lib/utils";
import { v4 } from "uuid";

const rpName = "coinos";

function getRpID(origin: string) {
  try {
    return new URL(origin).hostname;
  } catch {
    return "localhost";
  }
}

export async function generatePasskeyRegistration(user: any, origin: string) {
  const rpID = getRpID(origin);
  const passkeys = user.passkeys || [];

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.username,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: passkeys.map((p: any) => ({
      id: p.credentialID,
      transports: p.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  await db.set(`challenge:${user.id}`, options.challenge, { EX: 300 });

  return options;
}

export async function verifyPasskeyRegistration(user: any, response: any, origin: string) {
  const rpID = getRpID(origin);
  const expectedChallenge = await db.get(`challenge:${user.id}`);
  if (!expectedChallenge) fail("Challenge expired");

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    fail("Passkey verification failed");
  }

  await db.del(`challenge:${user.id}`);

  const { credential } = verification.registrationInfo;

  const cred = {
    credentialID: credential.id,
    credentialPublicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: response.response.transports || [],
    createdAt: Date.now(),
  };

  await db.set(`passkey:${credential.id}`, user.id);

  return cred;
}

export async function generatePasskeyLogin(origin: string) {
  const rpID = getRpID(origin);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });

  const challengeId = v4();
  await db.set(`challenge:passkey:${challengeId}`, options.challenge, { EX: 300 });

  return { ...options, challengeId };
}

export async function verifyPasskeyLogin(response: any, challengeId: string, origin: string) {
  const rpID = getRpID(origin);
  const userId = await db.get(`passkey:${response.id}`);
  if (!userId) fail("Passkey not recognized");

  const user = await g(`user:${userId}`);
  if (!user) fail("User not found");

  const passkeys = user.passkeys || [];
  const passkey = passkeys.find(
    (p: any) => p.credentialID === response.id,
  );
  if (!passkey) fail("Passkey not found");

  const expectedChallenge = await db.get(`challenge:passkey:${challengeId}`);
  if (!expectedChallenge) fail("Challenge expired");

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: passkey.credentialID,
      publicKey: Buffer.from(passkey.credentialPublicKey, "base64url"),
      counter: passkey.counter,
      transports: passkey.transports as AuthenticatorTransportFuture[],
    },
  });

  if (!verification.verified) fail("Passkey authentication failed");

  await db.del(`challenge:passkey:${challengeId}`);

  passkey.counter = verification.authenticationInfo.newCounter;
  await s(`user:${user.id}`, user);

  return user;
}
