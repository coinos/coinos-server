import wretch from "wretch";
import fetch from 'node-fetch';
wretch().polyfills({ fetch });
export default wretch;
