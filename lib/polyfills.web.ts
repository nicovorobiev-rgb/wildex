// Web: do NOT load react-native-url-polyfill — Safari throws
// "Cannot set indexed properties" when it monkey-patches the native URL.
// Browsers already have a spec-compliant URL/URLSearchParams.
export {};
