import app from "$app";
import db from "$db";
import redis from "$lib/db";
import { coinos, pool, q } from "$lib/nostr";
import store from "$lib/store";
import { nada, wait } from "$lib/utils";

