import js from '@eslint/js'
import ts from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import stylistic from '@stylistic/eslint-plugin'

export default defineConfig([
  globalIgnores([
    'data',
  ]),
  { files: ['**/*.{js,mjs,cjs,ts,mts,cts}'], plugins: { js }, extends: ['js/recommended'] },
  ts.configs.recommendedTypeChecked,
  ts.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      '@stylistic': stylistic,
    },
  },
  stylistic.configs.recommended,
])
