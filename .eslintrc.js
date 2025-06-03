module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
  ],
  rules: {
    // Disallow explicit any types as per user rules
    '@typescript-eslint/no-explicit-any': 'error',
    
    // Allow unused vars with underscore prefix
    '@typescript-eslint/no-unused-vars': ['error', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_' 
    }],
    
    // Allow empty functions (for placeholders)
    '@typescript-eslint/no-empty-function': 'off',
    
    // Require explicit return types for functions
    '@typescript-eslint/explicit-function-return-type': 'warn',
    
    // Prefer const over let when possible
    'prefer-const': 'error',
    
    // No console.log in production
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    
    // Consistent trailing commas
    '@typescript-eslint/comma-dangle': ['error', 'only-multiline'],
    
    // Consistent semicolons
    '@typescript-eslint/semi': ['error', 'always'],
    
    // Consistent quotes
    'quotes': ['error', 'single', { avoidEscape: true }],
    
    // No multiple empty lines
    'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],
    
    // Consistent indentation
    'indent': ['error', 2, { SwitchCase: 1 }],
  },
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    '*.js',
    'scripts/',
  ],
}; 