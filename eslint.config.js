import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'android/**', 'ios/**'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The audio/render hot paths run 60x a second; `for` over typed arrays is
      // deliberate there and should not be rewritten into allocating helpers.
      '@typescript-eslint/prefer-for-of': 'off',
      // `noUncheckedIndexedAccess` is on, which types every `array[i]` as
      // possibly undefined. In the DSP and simulation loops that is thousands
      // of reads per frame whose bounds are established by the loop itself, so
      // the assertion is the honest annotation and a runtime guard would be
      // pure overhead. The compiler flag, not this rule, is what keeps indexing
      // disciplined here.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // This config file is not part of the TypeScript program, so type-aware
    // rules have nothing to resolve it against.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
