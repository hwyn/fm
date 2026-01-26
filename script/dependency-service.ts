import gulp from 'gulp';
import through from 'through2';
import ts from 'typescript';
import { builtinModules } from 'module';
import { Injectable } from '@hwy-fm/di';

@Injectable()
export class DependencyService {

  public collect(src: string): Promise<string[]> {
    const dependencies: Set<string> = new Set();
    const pipeline = gulp.src([`${src}/**/*.{ts,tsx,js,jsx,mjs,cjs}`])
      .pipe(through.obj((file, enc, cb) => {
        if (file.isBuffer()) {
          try {
            this.visitSourceFile(file.path, file.contents.toString(enc), dependencies);
          } catch { }
        }
        cb(null, file);
      }));

    return new Promise((resolve, reject) => {
      pipeline.on('end', () => resolve(Array.from(dependencies).sort()));
      pipeline.on('error', reject);
      pipeline.resume();
    });
  }

  private visitSourceFile(fileName: string, content: string, dependencies: Set<string>) {
    // Optimization: setParentNodes=false (4th arg) as we don't need parent pointers
    const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, false);

    const visit = (node: ts.Node) => {
      const modulePath = this.extractModuleSpecifier(node);
      if (modulePath) {
        this.addDependency(dependencies, modulePath);
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  private extractModuleSpecifier(node: ts.Node): string | null {
    // Static imports/exports
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      return node.moduleSpecifier.text;
    }

    // Dynamic import() & require()
    if (ts.isCallExpression(node)) {
      // import('...')
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [arg] = node.arguments;
        return ts.isStringLiteral(arg) ? arg.text : null;
      }
      // require('...')
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const [arg] = node.arguments;
        return ts.isStringLiteral(arg) ? arg.text : null;
      }
    }

    return null;
  }

  private addDependency(dependencies: Set<string>, modulePath: string) {
    // Ignore relative and absolute paths
    if (modulePath.startsWith('.') || modulePath.startsWith('/')) {
      return;
    }

    // Normalize package name: @scope/pkg/sub -> @scope/pkg, pkg/sub -> pkg
    const parts = modulePath.split('/');
    const packageName = modulePath.startsWith('@') && parts.length > 1
      ? `${parts[0]}/${parts[1]}`
      : parts[0];

    // Filter out Node.js built-in modules
    if (!builtinModules.includes(packageName)) {
      dependencies.add(packageName);
    }
  }
}
