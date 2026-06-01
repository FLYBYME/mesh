// GENERATED FILE - DO NOT EDIT
import { z } from 'zod';
import type { IServiceToolRegistry } from '../interfaces/IServiceContext.js';
import * as Contract_0 from '../../../mesh-ui/src/services/uiservice/ui.contract.js';

declare module '../interfaces/IServiceContext.js' {
    interface IServiceToolRegistry {
        'ui.get_status': { params: z.input<typeof Contract_0.uiStatusContract['inputSchema']>, returns: z.infer<typeof Contract_0.uiStatusContract['outputSchema']> };
        'ui.build': { params: z.input<typeof Contract_0.uiBuildContract['inputSchema']>, returns: z.infer<typeof Contract_0.uiBuildContract['outputSchema']> };
        'uimanifest.create': { params: z.input<typeof Contract_0.uiManifestCrud['create']['inputSchema']>, returns: z.infer<typeof Contract_0.uiManifestCrud['create']['outputSchema']> };
        'uimanifest.find': { params: z.input<typeof Contract_0.uiManifestCrud['find']['inputSchema']>, returns: z.infer<typeof Contract_0.uiManifestCrud['find']['outputSchema']> };
        'uimanifest.find_one': { params: z.input<typeof Contract_0.uiManifestCrud['findOne']['inputSchema']>, returns: z.infer<typeof Contract_0.uiManifestCrud['findOne']['outputSchema']> };
        'uimanifest.count': { params: z.input<typeof Contract_0.uiManifestCrud['count']['inputSchema']>, returns: z.infer<typeof Contract_0.uiManifestCrud['count']['outputSchema']> };
        'uimanifest.get': { params: z.input<typeof Contract_0.uiManifestCrud['get']['inputSchema']>, returns: z.infer<typeof Contract_0.uiManifestCrud['get']['outputSchema']> };
        'uimanifest.update': { params: z.input<typeof Contract_0.uiManifestCrud['update']['inputSchema']>, returns: z.infer<typeof Contract_0.uiManifestCrud['update']['outputSchema']> };
        'uimanifest.delete': { params: z.input<typeof Contract_0.uiManifestCrud['delete']['inputSchema']>, returns: z.infer<typeof Contract_0.uiManifestCrud['delete']['outputSchema']> };
        'uiartifact.create': { params: z.input<typeof Contract_0.uiArtifactCrud['create']['inputSchema']>, returns: z.infer<typeof Contract_0.uiArtifactCrud['create']['outputSchema']> };
        'uiartifact.find': { params: z.input<typeof Contract_0.uiArtifactCrud['find']['inputSchema']>, returns: z.infer<typeof Contract_0.uiArtifactCrud['find']['outputSchema']> };
        'uiartifact.find_one': { params: z.input<typeof Contract_0.uiArtifactCrud['findOne']['inputSchema']>, returns: z.infer<typeof Contract_0.uiArtifactCrud['findOne']['outputSchema']> };
        'uiartifact.count': { params: z.input<typeof Contract_0.uiArtifactCrud['count']['inputSchema']>, returns: z.infer<typeof Contract_0.uiArtifactCrud['count']['outputSchema']> };
        'uiartifact.get': { params: z.input<typeof Contract_0.uiArtifactCrud['get']['inputSchema']>, returns: z.infer<typeof Contract_0.uiArtifactCrud['get']['outputSchema']> };
        'uiartifact.update': { params: z.input<typeof Contract_0.uiArtifactCrud['update']['inputSchema']>, returns: z.infer<typeof Contract_0.uiArtifactCrud['update']['outputSchema']> };
        'uiartifact.delete': { params: z.input<typeof Contract_0.uiArtifactCrud['delete']['inputSchema']>, returns: z.infer<typeof Contract_0.uiArtifactCrud['delete']['outputSchema']> };
    }
}

export type { IServiceToolRegistry };
