import app from "app";
import db from "$db";
import redis from "lib/redis";
import { coinos, pool, q } from "lib/nostr";
import store from "lib/store";
import { nada, wait } from "lib/utils";

