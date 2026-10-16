import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.next/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `const { drop, ...rest } = obj` is the idiomatic way to omit a key.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    // SPEC §13.2: dataset generation must not see the predicate registry, or
    // the bench would grade Engram on its own assumptions.
    files: ['bench/dataset/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@engram/core',
              importNames: ['PREDICATES', 'PREDICATE_NAMES', 'getPredicate', 'lookupPredicate'],
              message: 'The bench dataset must not see the predicate registry (SPEC §13.2).',
            },
          ],
          patterns: [
            {
              group: ['**/conflict/predicates*'],
              message: 'The bench dataset must not see the predicate registry (SPEC §13.2).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
