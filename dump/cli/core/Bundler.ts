import * as esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';

const packageRoot = path.resolve(__dirname, '../../..');

const castellanResolverPlugin = {
    name: 'castellan-resolver',
    setup(build: any) {
        build.onResolve({ filter: /^@sdk/ }, (args: any) => {
            const relPath = args.path.replace('@sdk', '').replace(/^\//, '').replace(/\.js$/, '.ts');
            return { path: path.resolve(process.cwd(), 'src/generated/client', relPath || 'index.ts') };
        });
        build.onResolve({ filter: /^@castellan\/api/ }, (args: any) => {
            const relPath = args.path.replace('@castellan/api', '').replace(/^\//, '').replace(/\.js$/, '.ts');
            return { path: path.resolve(process.cwd(), 'src/generated', relPath || 'index.ts') };
        });
        build.onResolve({ filter: /^@castellan\/client/ }, (args: any) => {
            const relPath = args.path.replace('@castellan/client', '').replace(/^\//, '').replace(/\.js$/, '.ts');
            return { path: path.resolve(packageRoot, 'src/client/core', relPath || 'index.ts') };
        });
        build.onResolve({ filter: /^@ui-lib/ }, (args: any) => {
            const relPath = args.path.replace('@ui-lib', '').replace(/^\//, '').replace(/\.js$/, '.ts');
            return { path: path.resolve(packageRoot, 'src/client/ui-lib', relPath || 'index.ts') };
        });
    }
};

export class Bundler {
    /**
     * Bundle a frontend extension
     */
    public static async bundleExtension(entryPoint: string, outDir: string, name: string): Promise<void> {
        await esbuild.build({
            entryPoints: [entryPoint],
            bundle: true,
            format: 'esm',
            platform: 'browser',
            outfile: path.join(outDir, `${name}.bundle.js`),
            external: ['react', 'react-dom', 'monaco-editor'],
            plugins: [castellanResolverPlugin],
            loader: {
                '.ts': 'ts',
                '.tsx': 'tsx',
                '.css': 'css',
                '.ttf': 'file',
                '.woff': 'file',
                '.woff2': 'file',
                '.svg': 'file',
                '.png': 'file',
                '.jpg': 'file',
                '.gif': 'file',
            },
            sourcemap: true,
            minify: true,
        });
    }


    /**
     * Bundle the core UI
     */
    public static async bundleCoreUI(entryPoint: string, outDir: string): Promise<void> {
        await esbuild.build({
            entryPoints: [entryPoint],
            bundle: true,
            format: 'esm',
            platform: 'browser',
            outfile: path.join(outDir, 'bundle.js'),
            plugins: [castellanResolverPlugin],
            loader: {
                '.ts': 'ts',
                '.tsx': 'tsx',
                '.css': 'css',
                '.ttf': 'file',
                '.woff': 'file',
                '.woff2': 'file',
                '.svg': 'file',
                '.png': 'file',
                '.jpg': 'file',
                '.gif': 'file',
            },
            sourcemap: true,
            minify: true,
        });
    }

    /**
     * Copy static assets (index.html, css, etc.)
     */
    public static copyAssets(srcDir: string, destDir: string): void {
        const filesToCopy = ['index.html', 'css'];

        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        filesToCopy.forEach(file => {
            const src = path.join(srcDir, file);
            const dest = path.join(destDir, file);

            if (fs.existsSync(src)) {
                if (fs.lstatSync(src).isDirectory()) {
                    this.copyDir(src, dest);
                } else {
                    fs.copyFileSync(src, dest);
                }
            }
        });
    }

    private static copyDir(src: string, dest: string): void {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                this.copyDir(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
}
