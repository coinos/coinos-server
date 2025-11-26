export interface User {
  about: string;
  admin: string;
  anon: string;
  autowithdraw: string;
  balance: string;
  banner: string;
  currencies: string;
  currency: string;
  destination: string;
  display: string;
  email: string;
  fiat: string;
  followers: string;
  follows: string;
  haspin: string;
  hasprinter: string;
  hidepay: string;
  id: string;
  index: string;
  keys: string;
  language: string;
  linked: string;
  locktime: string;
  memoPrompt: string;
  nip5: string;
  notify: string;
  npub: string;
  nsec: string;
  nwc: string;
  payments: string;
  picture: string;
  profile: string;
  prompt: string;
  pubkey: string;
  push: string;
  reserve: string;
  seed: string;
  shopifyStore: string;
  shopifyToken: string;
  theme: string;
  threshold: string;
  twofa: string;
  username: string;
  verified: string;
}

export enum PaymentType {
  ark = "ark",
  internal = "internal",
  bitcoin = "bitcoin",
  lightning = "lightning",
  fund = "fund",
  liquid = "liquid",
  ecash = "ecash",
  reconcile = "reconcile",
  bolt12 = "bolt12",
}

export interface Payment {
  id: string;
  aid: string;
  amount: number;
  fee: number;
  hash: string;
  hex?: string;
  ourfee: number;
  memo?: string;
  iid: string;
  uid: string;
  confirmed: boolean;
  rate: number;
  currency: string;
  type: PaymentType;
  ref: string;
  tip?: number;
  created: number;
  user?: User;
}
