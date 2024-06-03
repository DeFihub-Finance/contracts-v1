module.exports = {
    extends: [
        '@ryze-blockchain/eslint-config/base/typescript',
        '@ryze-blockchain/eslint-config/typescript',
    ],
    ignorePatterns: ['types/**'],
    rules: {
        '@typescript-eslint/explicit-module-boundary-types': 0,
    },
}
