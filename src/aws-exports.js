/* eslint-disable */
// Cognito/Amplify configuration — build-time injection via env vars (AD-08 / DEC-010).
//
// O arquivo gerado pela AWS Amplify (com Pool IDs hard-coded) foi REMOVIDO do Git.
// Os identificadores agora vêm de variáveis de ambiente injetadas no build, o que
// habilita canais beta/prod separados no desktop. Nenhum segredo é versionado aqui.
//
// Variáveis esperadas (ver `.env.example`):
//   REACT_APP_AWS_REGION             (default: us-east-1)
//   REACT_APP_COGNITO_POOL_ID        (obrigatória)
//   REACT_APP_COGNITO_APP_CLIENT_ID  (obrigatória)

const region = process.env.REACT_APP_AWS_REGION || 'us-east-1';

const awsmobile = {
    "aws_project_region": region,
    "aws_cognito_region": region,
    "aws_user_pools_id": process.env.REACT_APP_COGNITO_POOL_ID,
    "aws_user_pools_web_client_id": process.env.REACT_APP_COGNITO_APP_CLIENT_ID,
    "oauth": {},
    "aws_cognito_username_attributes": [
        "EMAIL"
    ],
    "aws_cognito_social_providers": [],
    "aws_cognito_signup_attributes": [
        "PREFERRED_USERNAME",
        "EMAIL"
    ],
    // MFA permanece OPTIONAL/dormente (DEC-007) — nenhuma UI MFA no desktop nesta fase.
    "aws_cognito_mfa_configuration": "OPTIONAL",
    "aws_cognito_mfa_types": [
        "TOTP"
    ],
    "aws_cognito_password_protection_settings": {
        "passwordPolicyMinLength": 8,
        "passwordPolicyCharacters": [
            "REQUIRES_LOWERCASE",
            "REQUIRES_UPPERCASE",
            "REQUIRES_NUMBERS",
            "REQUIRES_SYMBOLS"
        ]
    },
    "aws_cognito_verification_mechanisms": [
        "EMAIL"
    ]
};

if (!awsmobile.aws_user_pools_id || !awsmobile.aws_user_pools_web_client_id) {
    // Aviso explícito em build/runtime se as env vars não foram injetadas.
    console.warn(
        '[aws-exports] REACT_APP_COGNITO_POOL_ID / REACT_APP_COGNITO_APP_CLIENT_ID ausentes. ' +
        'Defina-as no .env (ver .env.example) antes de autenticar.'
    );
}

export default awsmobile;
