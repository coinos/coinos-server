import persist from "./persist.js";

export const addresses = {};
export const challenge = {};
export const change = [];
export const exceptions = [];
export const issuances = {};
export const logins = {};
export const seen = [];
export const sessions = {};
export const sockets = {};
export const unaccounted = [];
export const networks = [];
export const convert = persist("data/conversions.json");
