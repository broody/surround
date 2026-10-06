// Surround's protocol SDK (offchain/sdk, plain JavaScript, a file dependency):
// Go on arbiter, the keeper client and the session store. Untyped here;
// src/rated wraps what the app uses in typed calls.
declare module "@surround/offchain" {
  const sdk: any;
  export = sdk;
}
declare module "@surround/offchain/client" {
  const client: any;
  export = client;
}
