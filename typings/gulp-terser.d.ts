declare module 'gulp-terser' {
  import { Transform } from 'stream';
  function terser(options?: any): Transform;
  export default terser;
}
