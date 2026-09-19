import antfu from '@antfu/eslint-config'
import { globalIgnores } from 'eslint/config'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(antfu(
  globalIgnores([
    '.cursor/**',
    '.agents/**',
    '.nuxt/**',
    '.output/**',
    '.data/**',
    'dist/**',
  ]),
  {
    rules: {
      // Allow trailing space in comments, for possible JSDoc formattings
      'style/no-trailing-spaces': ['error', { ignoreComments: true }],
      // Relaxes inline statements a bit
      'style/max-statements-per-line': ['error', { max: 2 }],
    },
  },
  // The executable test harnesses predate the application lint style. Keep
  // their correctness checks active without forcing a whole-file formatting
  // migration in the baseline repair.
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      'style/indent': 'off',
      'style/semi': 'off',
      'style/object-curly-spacing': 'off',
      'style/key-spacing': 'off',
      'style/comma-spacing': 'off',
      'style/arrow-spacing': 'off',
      'style/space-infix-ops': 'off',
      'style/space-before-function-paren': 'off',
      'style/keyword-spacing': 'off',
      'style/block-spacing': 'off',
      'style/arrow-parens': 'off',
      'style/max-statements-per-line': 'off',
      'style/semi-spacing': 'off',
      'style/no-multiple-empty-lines': 'off',
      'style/quotes': 'off',
      'style/quote-props': 'off',
      'style/comma-dangle': 'off',
      'style/no-multi-spaces': 'off',
      'antfu/consistent-list-newline': 'off',
      'antfu/if-newline': 'off',
      'antfu/curly': 'off',
      'import/newline-after-import': 'off',
      'import/no-duplicates': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-named-imports': 'off',
      'node/prefer-global/buffer': 'off',
      'unicorn/prefer-number-properties': 'off',
      'unicorn/new-for-builtins': 'off',
      'prefer-template': 'off',
    },
  },
  {
    // This tooltip intentionally mounts a configurable component for each
    // datapoint; vue/one-component-per-file treats those dynamic mounts as
    // extra SFC declarations.
    files: ['app/components/ui/chart/ChartSingleTooltip.vue'],
    rules: {
      'vue/one-component-per-file': 'off',
    },
  },
  // Allow trailing space for markdown formatting
  {
    files: ['**/*.md'],
    rules: {
      'style/no-trailing-spaces': 'off',
    },
  },
))
