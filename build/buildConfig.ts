/**
 * When `true`, self-hosting uses esbuild for fast transpilation (build/next)
 * and gulp-tsb only for type-checking (`noEmit`).
 *
 * When `false`, gulp-tsb does both transpilation and type-checking (old behavior).
 */
export const useEsbuildTranspile = true;
