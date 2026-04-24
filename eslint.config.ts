import prettier from 'eslint-plugin-prettier/recommended'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  tseslint.configs.recommended,
  tseslint.configs.strict,
  {
    files: ['**/*.ts'],
  },
  prettier,
)
