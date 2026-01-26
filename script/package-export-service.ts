import fs from 'fs';
import path from 'path';
import { Injectable, Inject } from '@hwy-fm/di';
import { CONFIGS } from './constant';

@Injectable()
export class PackageExportService {

  constructor(@Inject(CONFIGS) private configs: any) { }

  public getExportsAndRootFields(packageRoot: string, sideEffects: boolean, extraExports: any) {
    if (sideEffects) {
      return { exports: extraExports || {}, rootFields: {} };
    }

    const exportsList = this.readExportsPath(path.join(packageRoot, 'cjs'));
    const { exports: autoExports, rootFields } = this.resolveExportsAndRootFields(packageRoot, exportsList);

    const exports = Object.keys(autoExports).length > 0 ? autoExports : extraExports;

    return { exports, rootFields };
  }

  private readExportsPath(packagePath: string, root = ''): Array<[string, string]> {
    if (!fs.existsSync(packagePath)) return [];

    const exportArray: Array<[string, string]> = [];
    const currentRoot = path.join(packagePath, root);

    if (!fs.existsSync(currentRoot)) return [];

    const files = fs.readdirSync(currentRoot);

    if (files.includes('index.js')) {
      exportArray.push([root, `${root}/index.js`]);
    }

    if (root) {
      exportArray.push([`${root}/*`, `${root}/*.js`]);
    }

    files.forEach((fileName) => {
      if (fs.statSync(path.join(currentRoot, fileName)).isDirectory()) {
        exportArray.push(...this.readExportsPath(packagePath, path.join(root, fileName)));
      }
    });

    return exportArray;
  }

  private resolveExportsAndRootFields(packageRoot: string, pathList: Array<[string, string]>) {
    const exports: Record<string, any> = {};
    const rootFields: Record<string, string> = {};
    const exportConfig = this.getExportConfig();
    const configKeys = Object.keys(exportConfig);

    pathList.forEach(([subPath, exportFilesPath]) => {
      const exportKey = this.normalizeKey(subPath ? `./${subPath}` : '.');
      const exportEntry: Record<string, string> = {};

      configKeys.forEach(key => {
        const { folder, field } = exportConfig[key];
        const relativePath = this.resolveRelativePath(folder, exportFilesPath, key);

        exportEntry[key] = relativePath;

        if (subPath === '') {
          this.updateRootFields(packageRoot, rootFields, field, key, relativePath);
        }
      });

      exports[exportKey] = exportEntry;
    });

    this.ensureMainField(packageRoot, rootFields);

    return { exports, rootFields };
  }

  private getExportConfig() {
    const exportConfig: any = {};
    Object.entries(this.configs.buildConfig).forEach(([name, config]: any) => {
      if (config.exports) {
        const folder = config.folder ?? name;
        Object.entries(config.exports).forEach(([key, field]) => {
          exportConfig[key] = { folder, field };
        });
      }
    });
    return exportConfig;
  }

  private resolveRelativePath(folder: string, exportFilesPath: string, key: string) {
    const ext = key === 'types' ? '.d.ts' : '.js';
    const targetPath = folder ? `./${folder}/${exportFilesPath}` : `./${exportFilesPath}`;
    return targetPath.replace(/[\\|\/]+/g, '/').replace(/\.js$/, ext);
  }

  private updateRootFields(packageRoot: string, rootFields: Record<string, string>, field: string, key: string, targetPath: string) {
    const absPath = path.join(packageRoot, targetPath);
    if (!fs.existsSync(absPath)) return;

    if (field) {
      if (field === 'main' && key === 'node' && rootFields.main) return;
      rootFields[field] = targetPath;
    }
  }

  private ensureMainField(packageRoot: string, rootFields: Record<string, string>) {
    if (!rootFields.main) {
      const cjsIndex = './cjs/index.js';
      if (fs.existsSync(path.join(packageRoot, cjsIndex))) {
        rootFields.main = cjsIndex;
      }
    }
  }

  private normalizeKey(key: string) {
    return key.replace(/[\\|\/]+/g, '/');
  }
}
