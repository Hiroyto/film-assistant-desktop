// BC-01 Identity & Session — API pública da feature auth.
export * as cognito from './api/cognito';
export * from './model/useAuth';
export * from './model/session';
export * from './model/passwordPolicy';
export * from './model/resendThrottle';
export { getMfaConfigured } from './model/mfa';
