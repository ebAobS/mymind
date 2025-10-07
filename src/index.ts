import {
    Plugin,
    showMessage,
    Dialog,
    openTab,
    getAllEditor,
    Menu,
} from "siyuan";

import type zh_CN from '../public/i18n/zh_CN.json'

import "./index.scss";

import {client} from "@/client";
import {SettingUtils} from "@/libs/setting-utils";
import * as api from "@/api";
import {getProtyle} from "@/SiyuanUtils";
import {parseMarkdownToMindMap} from "@/libs/markdown-parser";
import {parseDocumentBlocksToMindMap} from "@/libs/block-parser";

// @ts-ignore
import MindMap from 'simple-mind-map';
// @ts-ignore
import Drag from 'simple-mind-map/src/plugins/Drag.js';
// @ts-ignore
import Select from 'simple-mind-map/src/plugins/Select.js';
// @ts-ignore
import RichText from 'simple-mind-map/src/plugins/RichText.js';
// @ts-ignore
import NodeImgAdjust from 'simple-mind-map/src/plugins/NodeImgAdjust.js';
// @ts-ignore
import Export from 'simple-mind-map/src/plugins/Export.js';
// @ts-ignore
import ExportPDF from 'simple-mind-map/src/plugins/ExportPDF.js';
// @ts-ignore
import ExportXMind from 'simple-mind-map/src/plugins/ExportXMind.js';
// @ts-ignore
import AssociativeLine from 'simple-mind-map/src/plugins/AssociativeLine.js';
// @ts-ignore
import { transformToMarkdown } from 'simple-mind-map/src/parse/toMarkdown.js';
// @ts-ignore
import xmind from 'simple-mind-map/src/parse/xmind.js';
import { registerThemes, getThemeList } from '@/libs/themes';
// @ts-ignore
import JSZip from 'jszip';

// 注册插件
MindMap.usePlugin(Drag);
MindMap.usePlugin(Select);
MindMap.usePlugin(RichText);
MindMap.usePlugin(NodeImgAdjust);
MindMap.usePlugin(Export);  // 必须先注册基础的 Export 插件
MindMap.usePlugin(ExportPDF);
MindMap.usePlugin(ExportXMind);
MindMap.usePlugin(AssociativeLine);  // 关联线插件

// 注册主题
registerThemes(MindMap);

const ICON_NAME = "icon-park-outline--mindmap-map";
const DOC_ICON_NAME = "icon-park-outline--doc-mindmap";

const docTreeExpandLevelName = "docTreeExpandLevel"; // 文档树思维导图展开层级
const docMindMapExpandLevelName = "docMindMapExpandLevel"; // 文档思维导图展开层级
const docTreeThemeName = "docTreeTheme"; // 文档树思维导图主题
const docMindMapThemeName = "docMindMapTheme"; // 文档思维导图主题
const showAssociativeLineName = "showAssociativeLine"; // 是否显示文档关联线
const showSaveWarningName = "showSaveWarning"; // 是否显示保存警告
const headingLevelsName = "headingLevels"; // Markdown 标题级数
const enableDebugLogName = "enableDebugLog"; // 是否启用调试日志
const initialExpandLevelName = "initialExpandLevel"; // 兼容旧版本，后续可删除
const darkModeClassName = "markmap-dark";

// 定义思维导图节点结构
interface MindMapNode {
    data: {
        text: string;
        uid?: string;  // simple-mind-map 使用 uid 作为节点唯一标识
        id?: string;
        notebookId?: string;
        hpath?: string;
        path?: string;  // 文件系统路径
        isRoot?: boolean;
        isNotebook?: boolean;
        isWorkspace?: boolean;
        expand?: boolean;  // 节点展开状态
    };
    children?: MindMapNode[];
}

export default class SiYuanDocTreePlugin extends Plugin {

    private settingUtils: SettingUtils;
    private mindMap: any = null;
    private docMindMap: any = null; // 文档思维导图实例
    private lastNodeMap: Map<string, any> = new Map(); // 用于跟踪节点变化
    private embeddedMindMaps: Map<string, any> = new Map(); // 嵌入的思维导图实例
    private isInitializing: boolean = false; // 标记是否正在初始化，防止初始渲染时触发重命名
    private documentObserver: MutationObserver | null = null; // 文档变化监听器
    typedI18n: typeof zh_CN

    /**
     * 条件日志输出 - 仅在启用调试日志时输出
     */
    private debugLog(...args: any[]) {
        if (this.settingUtils?.get(enableDebugLogName)) {
            console.log('[MyMind]', ...args);
        }
    }

    private debugWarn(...args: any[]) {
        if (this.settingUtils?.get(enableDebugLogName)) {
            console.warn('[MyMind]', ...args);
        }
    }

    private debugError(...args: any[]) {
        // 错误日志始终输出，但添加前缀
        console.error('[MyMind]', ...args);
    }

    async onload() {
        this.typedI18n = this.i18n as any
        await this.initSettings();

        // 图标的制作参见帮助文档
        this.addIcons(`
            <symbol id="icon-park-outline--mindmap-map" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"><circle cx="24" cy="24" r="4"/><circle cx="10" cy="10" r="3"/><circle cx="38" cy="10" r="3"/><circle cx="10" cy="38" r="3"/><circle cx="38" cy="38" r="3"/><path d="M21 21l-8-8m15 8l8-8m-15 6l-8 8m15-8l8 8"/></g></symbol>
            <symbol id="icon-park-outline--doc-mindmap" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="4"><path d="M8 6a2 2 0 0 1 2-2h28a2 2 0 0 1 2 2v40H10a2 2 0 0 1-2-2z"/><path stroke-linecap="round" d="M16 20h16m-16 8h8m-8 8h16"/></g></symbol>
            `);
        // 添加快捷键 - 文档树思维导图
        this.addCommand({
            langKey: "actionName",
            langText: this.typedI18n.actionName,
            hotkey: "⌥Q", // Alt+Q
            callback: () => this.openDocTreeDialog(),
            fileTreeCallback: () => this.openDocTreeDialog(),
            editorCallback: () => this.openDocTreeDialog(),
            dockCallback: () => this.openDocTreeDialog(),
        });

        // 添加快捷键 - 文档思维导图
        this.addCommand({
            langKey: "docMindMapActionName",
            langText: this.typedI18n.docMindMapActionName,
            hotkey: "⌥W", // Alt+W
            callback: () => this.openDocMindMapDialog(),
            fileTreeCallback: () => this.openDocMindMapDialog(),
            editorCallback: () => this.openDocMindMapDialog(),
            dockCallback: () => this.openDocMindMapDialog(),
        });

        // 添加命令 - 插入思维导图块
        this.addCommand({
            langKey: "insertMindMapBlockActionName",
            langText: this.i18n.insertMindMapBlockActionName || "插入文档思维导图块",
            hotkey: "⌥E", // Alt+E
            editorCallback: () => this.showInsertMindMapDialog(),
        });

    }

    private async initSettings() {
        this.settingUtils = new SettingUtils({
            plugin: this
        });
        
        // 文档树思维导图展开层级
        this.settingUtils.addItem({
            key: docTreeExpandLevelName,
            value: 3,
            type: "number",
            title: "文档树思维导图默认展开层级",
            description: "设置文档树思维导图默认展开多少层（0 = 全部展开，1 = 仅根节点，2 = 根节点+1层，3 = 根节点+2层，以此类推）",
            action: {
                // 添加验证
                callback: () => {
                    const input = document.querySelector(`input[data-key="${docTreeExpandLevelName}"]`) as HTMLInputElement;
                    if (input) {
                        const value = parseInt(input.value);
                        if (isNaN(value) || value < 0) {
                            showMessage('展开层级必须是大于或等于 0 的整数', 3000, 'error');
                            input.value = '3';
                            return;
                        }
                    }
                }
            }
        });
        
        // 文档思维导图展开层级
        this.settingUtils.addItem({
            key: docMindMapExpandLevelName,
            value: 3,
            type: "number",
            title: "文档思维导图默认展开层级",
            description: "设置文档思维导图和行内思维导图默认展开多少层（0 = 全部展开，1 = 仅根节点，2 = 根节点+1层，3 = 根节点+2层，以此类推）",
            action: {
                // 添加验证
                callback: () => {
                    const input = document.querySelector(`input[data-key="${docMindMapExpandLevelName}"]`) as HTMLInputElement;
                    if (input) {
                        const value = parseInt(input.value);
                        if (isNaN(value) || value < 0) {
                            showMessage('展开层级必须是大于或等于 0 的整数', 3000, 'error');
                            input.value = '3';
                            return;
                        }
                    }
                }
            }
        });

        // 文档树思维导图主题
        const themeOptions = {};
        getThemeList().forEach(theme => {
            themeOptions[theme.value] = theme.name;
        });
        
        this.settingUtils.addItem({
            key: docTreeThemeName,
            value: 'default',
            type: "select",
            title: "文档树思维导图主题",
            description: "选择文档树思维导图的默认主题样式",
            options: themeOptions
        });

        // 文档思维导图主题
        this.settingUtils.addItem({
            key: docMindMapThemeName,
            value: 'default',
            type: "select",
            title: "文档思维导图主题",
            description: "选择文档思维导图和行内思维导图的默认主题样式",
            options: themeOptions
        });

        // 是否显示文档关联线
        this.settingUtils.addItem({
            key: showAssociativeLineName,
            value: true,
            type: "checkbox",
            title: "显示文档关联线",
            description: "在文档树思维导图中显示文档之间的引用关系（关联线）"
        });

        // 保存警告提示
        this.settingUtils.addItem({
            key: showSaveWarningName,
            value: true,
            type: "checkbox",
            title: "显示保存警告",
            description: "保存文档思维导图到思源文档时，显示可能丢失部分内容的警告提示"
        });

        // Markdown 标题级数
        this.settingUtils.addItem({
            key: headingLevelsName,
            value: 6,
            type: "number",
            title: "Markdown 标题级数",
            description: "设置思维导图转换为 Markdown 时的标题级数（1-6 之间的整数）。超过设置级数的节点将转换为无序列表。例如设置为 4，则第 5 级节点变为无序列表，第 6 级变为缩进一级的无序列表。",
            action: {
                // 添加验证
                callback: () => {
                    const input = document.querySelector(`input[data-key="${headingLevelsName}"]`) as HTMLInputElement;
                    if (input) {
                        const value = parseInt(input.value);
                        if (isNaN(value) || value < 1 || value > 6) {
                            showMessage('标题级数必须是 1 到 6 之间的整数', 3000, 'error');
                            input.value = '6';
                            return;
                        }
                    }
                }
            }
        });

        // 启用调试日志
        this.settingUtils.addItem({
            key: enableDebugLogName,
            value: false,
            type: "checkbox",
            title: "启用调试日志",
            description: "开启后会在控制台输出详细的调试日志，用于问题排查。默认关闭以提升性能和减少内存占用。"
        });
        
        await this.settingUtils.load(); //导入配置并合并
    }

    onLayoutReady() {
        
        // 添加顶部工具栏按钮
        const topBarElement = this.addTopBar({
            icon: ICON_NAME,
            title: this.i18n.actionName || "思维导图",
            position: "right",
            callback: (evt: MouseEvent) => this.showTopBarMenu(evt, topBarElement),
        });

        // 延迟初始化已存在的嵌入式思维导图（确保思源完全加载）
        setTimeout(() => {
            this.initAllEmbeddedMindMaps();
        }, 2000);

        // 监听文档变化，自动初始化新插入的思维导图块
        this.observeDocumentChanges();

        // 监听文档切换和刷新事件
        this.observeDocumentSwitch();
    }

    /**
     * 显示顶栏按钮菜单
     */
    showTopBarMenu(evt: MouseEvent, topBarElement: HTMLElement) {
        const menu = new Menu("topBarMenu");
        
        // 1. 文档树思维导图
        menu.addItem({
            icon: "iconListItem",
            label: this.i18n.actionName || "文档树思维导图",
            click: () => {
                this.openDocTreeDialog();
            }
        });
        
        // 2. 文档思维导图
        menu.addItem({
            icon: "iconFile",
            label: this.i18n.docMindMapActionName || "文档思维导图",
            click: () => {
                this.openDocMindMapDialog();
            }
        });
        
        // 3. 插入行内思维导图
        menu.addItem({
            icon: DOC_ICON_NAME,
            label: this.i18n.insertMindMapBlockActionName || "插入行内思维导图",
            click: () => {
                this.showInsertMindMapDialog();
            }
        });
        
        // 4. 设置
        menu.addItem({
            icon: "iconSettings",
            label: "设置",
            click: () => {
                this.openSetting();
            }
        });
        
        // 获取按钮的位置
        const rect = topBarElement.getBoundingClientRect();
        menu.open({
            x: rect.left,
            y: rect.bottom,
            isLeft: true,
        });
    }

    /**
     * 递归获取文档树（使用 listDocsByPath API）
     * @param notebookId 笔记本ID
     * @param path 当前路径（文档ID或"/"）
     * @param depth 当前递归深度（用于调试）
     * @returns 文档节点数组
     */
    async fetchDocumentTreeRecursive(notebookId: string, path: string = "/", depth: number = 0): Promise<MindMapNode[]> {
        try {
            this.debugLog(`[深度${depth}] 获取路径 ${path} 下的文档...`);
            const result = await api.listDocsByPath(notebookId, path);
            
            this.debugLog(`[深度${depth}] API 返回结果:`, result);
            
            if (!result || !result.files || result.files.length === 0) {
                this.debugLog(`[深度${depth}] 路径 ${path} 下没有文档`);
                return [];
            }

            const nodes: MindMapNode[] = [];
            
            for (const file of result.files) {
                // 只处理文档类型
                if (!file.id) {
                    this.debugLog(`[深度${depth}] 跳过非文档项:`, file);
                    continue;
                }
                
                // 处理文档名称，去掉 .sy 后缀
                let docName = file.name || '未命名文档';
                // 去掉 .sy 后缀
                if (docName.endsWith('.sy')) {
                    docName = docName.slice(0, -3);
                }
                // 截断过长的标题
                if (docName.length > 50) {
                    docName = docName.substring(0, 47) + '...';
                }
                
                this.debugLog(`[深度${depth}] 处理文档: ${docName} (${file.id}), subFileCount: ${file.subFileCount}`);
                
                const node: MindMapNode = {
                    data: {
                        text: docName,
                        uid: `doc-${file.id}`,
                        id: file.id,
                        notebookId: notebookId,
                        path: file.path,
                        hpath: file.hPath // 添加层级路径
                    },
                    children: []
                };
                
                // 只有当 subFileCount > 0 时才递归获取子文档
                if (file.subFileCount && file.subFileCount > 0) {
                    this.debugLog(`[深度${depth}] 文档 ${docName} 有 ${file.subFileCount} 个子文档，开始递归...`);
                    try {
                        // 使用文档路径（去掉.sy后缀）作为子目录路径
                        let childPath = file.path;
                        if (childPath.endsWith('.sy')) {
                            childPath = childPath.slice(0, -3); // 去掉 .sy 后缀
                        }
                        this.debugLog(`[深度${depth}] 使用路径: ${childPath}`);
                        
                        const children = await this.fetchDocumentTreeRecursive(notebookId, childPath, depth + 1);
                        if (children.length > 0) {
                            node.children = children;
                            this.debugLog(`[深度${depth}] 文档 ${docName} 获取到 ${children.length} 个子文档`);
                        } else {
                            this.debugLog(`[深度${depth}] 文档 ${docName} 实际没有子文档（可能是数据不一致）`);
                        }
                    } catch (childError) {
                        this.debugError(`[深度${depth}] 获取文档 ${docName} 的子文档失败:`, childError);
                        // 继续处理其他文档，不中断
                    }
                } else {
                    this.debugLog(`[深度${depth}] 文档 ${docName} 没有子文档`);
                }
                
                nodes.push(node);
            }
            
            this.debugLog(`[深度${depth}] 路径 ${path} 共返回 ${nodes.length} 个文档节点`);
            return nodes;
        } catch (error) {
            this.debugError(`[深度${depth}] 获取路径 ${path} 下的文档失败:`, error);
            return [];
        }
    }

    /**
     * 构建文档树的思维导图数据（使用 API 递归获取）
     */
    async buildDocTreeMindMap(): Promise<MindMapNode> {
        try {
            // 获取工作空间信息
            const workspacesResp = await api.getWorkspaces();
            const workspaceName = workspacesResp?.workspaces?.[0]?.name || "工作空间";

            // 获取所有笔记本
            const notebooksResp = await api.lsNotebooks();
            const notebooks = notebooksResp?.notebooks || [];

            // 构建根节点
            const rootNode: MindMapNode = {
                data: {
                    text: workspaceName,
                    uid: 'workspace-root',
                    isWorkspace: true,
                    isRoot: true
                },
                children: []
            };

            this.debugLog('开始构建文档树，笔记本数量:', notebooks.length);

            // 遍历每个笔记本
            for (const notebook of notebooks) {
                if (notebook.closed) {
                    this.debugLog(`跳过已关闭的笔记本: ${notebook.name}`);
                    continue; // 跳过已关闭的笔记本
                }

                this.debugLog(`处理笔记本: ${notebook.name} (${notebook.id})`);

                const notebookNode: MindMapNode = {
                    data: {
                        text: notebook.name,
                        uid: `notebook-${notebook.id}`,
                        id: notebook.id,
                        notebookId: notebook.id,
                        isNotebook: true
                    },
                    children: []
                };

                // 递归获取笔记本下的文档树（从根目录"/"开始）
                const docs = await this.fetchDocumentTreeRecursive(notebook.id, "/");
                notebookNode.children = docs;
                
                this.debugLog(`笔记本 ${notebook.name} 的根文档数量:`, docs.length);

                // 将笔记本节点添加到工作空间节点
                rootNode.children.push(notebookNode);
            }

            this.debugLog('文档树构建完成');
            return rootNode;
        } catch (error) {
            this.debugError("构建文档树失败:", error);
            showMessage("构建文档树失败: " + error.message, 5000, "error");
            return {
                data: {
                    text: "错误",
                    isRoot: true
                },
                children: []
            };
        }
    }

    /**
     * 收集文档树中所有文档节点的ID
     * @param node 当前节点
     * @param docIds 文档ID集合
     */
    private collectDocumentIds(node: MindMapNode, docIds: Set<string>): void {
        // 如果节点有文档ID且不是笔记本或工作空间节点，则收集
        if (node.data.id && !node.data.isNotebook && !node.data.isWorkspace && !node.data.isRoot) {
            docIds.add(node.data.id);
        }
        
        // 递归处理子节点
        if (node.children) {
            for (const child of node.children) {
                this.collectDocumentIds(child, docIds);
            }
        }
    }

    /**
     * 获取文档之间的链接关系
     * @param docIds 文档ID集合
     * @returns 链接关系列表 [{ from: 出链文档ID, to: 入链文档ID }]
     */
    private async getDocumentLinks(docIds: Set<string>): Promise<Array<{ from: string, to: string }>> {
        const links: Array<{ from: string, to: string }> = [];
        const linkMap = new Map<string, Set<string>>(); // 用于去重：from -> Set<to>
        const docIdArray = Array.from(docIds);
        
        this.debugLog(`开始获取 ${docIdArray.length} 个文档的链接关系...`);
        
        try {
            // 方法1: 查询文档内所有块的出链（root_id 是出链文档）
            // 这会查找所有在 docIds 中的文档内的块，指向其他文档的引用
            const docIdList = docIdArray.map(id => `'${id}'`).join(',');
            const sql = `SELECT DISTINCT root_id, def_block_root_id FROM refs WHERE root_id IN (${docIdList}) AND def_block_root_id IS NOT NULL AND def_block_root_id != ''`;
            
            this.debugLog('执行 SQL 查询:', sql);
            const refs = await api.sql(sql);
            
            this.debugLog(`SQL 查询返回 ${refs ? refs.length : 0} 条结果`);
            
            if (refs && refs.length > 0) {
                for (const ref of refs) {
                    const fromDocId = ref.root_id; // 出链文档（包含引用的文档）
                    const toDocId = ref.def_block_root_id; // 入链文档（被引用的文档）
                    
                    // 只添加在文档树中都存在的链接，且不是自引用
                    if (fromDocId && toDocId && 
                        docIds.has(fromDocId) && 
                        docIds.has(toDocId) && 
                        fromDocId !== toDocId) {
                        
                        // 使用 Map 去重
                        if (!linkMap.has(fromDocId)) {
                            linkMap.set(fromDocId, new Set());
                        }
                        linkMap.get(fromDocId)!.add(toDocId);
                    }
                }
                
                // 转换为数组
                linkMap.forEach((toSet, fromId) => {
                    toSet.forEach(toId => {
                        links.push({
                            from: fromId,
                            to: toId
                        });
                    });
                });
            }
            
            this.debugLog(`共发现 ${links.length} 条文档链接关系`);
            
            // 打印前几条链接关系用于调试
            if (links.length > 0) {
                this.debugLog('前 5 条链接关系:', links.slice(0, 5));
            }
            
        } catch (error) {
            this.debugError('获取文档链接关系失败:', error);
        }
        
        return links;
    }

    /**
     * 加载并渲染文档树的关联线
     * @param docTree 文档树数据
     * @param showSuccessMessage 是否显示成功消息
     */
    private async loadAssociativeLines(docTree: MindMapNode, showSuccessMessage: boolean = true): Promise<void> {
        try {
            this.debugLog('===== 开始加载文档关联线 =====');
            
            // 检查思维导图实例
            if (!this.mindMap) {
                this.debugError('思维导图实例不存在');
                return;
            }
            
            // 检查插件
            if (!this.mindMap.associativeLine) {
                this.debugError('关联线插件未加载！');
                if (showSuccessMessage) {
                    showMessage('关联线插件未加载，无法显示文档链接', 3000, 'error');
                }
                return;
            }
            
            // 收集所有文档ID
            const docIds = new Set<string>();
            this.collectDocumentIds(docTree, docIds);
            this.debugLog(`收集到 ${docIds.size} 个文档节点`);
            
            // 获取文档之间的链接关系
            const links = await this.getDocumentLinks(docIds);
            this.debugLog(`发现 ${links.length} 条文档链接关系`);
            
            if (links.length === 0) {
                this.debugLog('没有发现文档之间的链接关系');
                return;
            }
            
            // 添加关联线
            await this.addAssociativeLines(this.mindMap, links, docTree);
            
            if (showSuccessMessage && links.length > 0) {
                showMessage(`已添加 ${links.length} 条文档关联线`, 2000, 'info');
            }
            
            this.debugLog('===== 文档关联线加载完成 =====');
        } catch (error) {
            this.debugError('加载关联线失败:', error);
            if (showSuccessMessage) {
                showMessage('加载关联线失败: ' + error.message, 3000, 'error');
            }
        }
    }

    /**
     * 在思维导图中添加关联线
     * @param mindMap 思维导图实例
     * @param links 链接关系列表
     * @param docTree 文档树数据
     */
    private async addAssociativeLines(mindMap: any, links: Array<{ from: string, to: string }>, docTree: MindMapNode): Promise<void> {
        if (!mindMap || !links || links.length === 0) {
            this.debugLog('没有需要添加的关联线');
            return;
        }

        this.debugLog(`准备添加 ${links.length} 条关联线...`);
        this.debugLog('关联线插件实例:', mindMap.associativeLine);

        // 等待思维导图完全渲染
        await new Promise(resolve => setTimeout(resolve, 500));

        let successCount = 0;
        let failCount = 0;

        for (const link of links) {
            try {
                // 构建节点的 uid
                const fromUid = `doc-${link.from}`;
                const toUid = `doc-${link.to}`;

                this.debugLog(`\n尝试添加关联线: ${fromUid} -> ${toUid}`);

                // 查找对应的节点 - 尝试多种查找方式
                let fromNode = null;
                let toNode = null;
                
                // 方式1: 通过 renderer.findNodeByUid
                if (mindMap.renderer && typeof mindMap.renderer.findNodeByUid === 'function') {
                    fromNode = mindMap.renderer.findNodeByUid(fromUid);
                    toNode = mindMap.renderer.findNodeByUid(toUid);
                    this.debugLog('通过 renderer.findNodeByUid 查找节点:', !!fromNode, !!toNode);
                }
                
                // 方式2: 如果方式1失败，尝试通过 renderer.root 递归查找
                if (!fromNode || !toNode) {
                    const findNode = (node: any, uid: string): any => {
                        if (!node) return null;
                        const nodeData = node.getData ? node.getData() : node.data;
                        if (nodeData && nodeData.uid === uid) return node;
                        if (node.children) {
                            for (const child of node.children) {
                                const found = findNode(child, uid);
                                if (found) return found;
                            }
                        }
                        return null;
                    };
                    
                    if (!fromNode && mindMap.renderer && mindMap.renderer.root) {
                        fromNode = findNode(mindMap.renderer.root, fromUid);
                    }
                    if (!toNode && mindMap.renderer && mindMap.renderer.root) {
                        toNode = findNode(mindMap.renderer.root, toUid);
                    }
                    this.debugLog('通过递归查找节点:', !!fromNode, !!toNode);
                }

                if (fromNode && toNode) {
                    this.debugLog('找到两个节点，准备添加关联线');
                    this.debugLog('fromNode:', fromNode);
                    this.debugLog('toNode:', toNode);
                    
                    // 直接调用 associativeLine 的方法添加关联线
                    try {
                        // 使用官方文档推荐的方法
                        mindMap.associativeLine.addLine(fromNode, toNode);
                        this.debugLog('✓ 成功添加关联线');
                        successCount++;
                    } catch (err) {
                        this.debugError('调用 addLine 失败:', err);
                        
                        // 尝试其他可能的方法
                        try {
                            if (typeof mindMap.associativeLine.createLine === 'function') {
                                mindMap.associativeLine.createLine(fromNode, toNode);
                                this.debugLog('✓ 使用 createLine 成功');
                                successCount++;
                            } else if (typeof mindMap.associativeLine.createLineFromNodeToNode === 'function') {
                                mindMap.associativeLine.createLineFromNodeToNode(fromNode, toNode);
                                this.debugLog('✓ 使用 createLineFromNodeToNode 成功');
                                successCount++;
                            } else {
                                this.debugError('× 找不到可用的添加关联线方法');
                                this.debugError('可用方法:', Object.getOwnPropertyNames(mindMap.associativeLine));
                                failCount++;
                            }
                        } catch (err2) {
                            this.debugError('× 所有方法都失败:', err2);
                            failCount++;
                        }
                    }
                } else {
                    this.debugWarn(`× 无法找到节点: from=${fromUid}(${!!fromNode}), to=${toUid}(${!!toNode})`);
                    
                    // 打印所有可用节点用于调试
                    if (!fromNode || !toNode) {
                        this.debugLog('打印所有节点的 uid 用于调试:');
                        const printAllUids = (node: any, prefix: string = '') => {
                            if (!node) return;
                            const nodeData = node.getData ? node.getData() : node.data;
                            if (nodeData && nodeData.uid) {
                                this.debugLog(`${prefix}${nodeData.uid}`);
                            }
                            if (node.children) {
                                node.children.forEach((child: any) => printAllUids(child, prefix + '  '));
                            }
                        };
                        if (mindMap.renderer && mindMap.renderer.root) {
                            printAllUids(mindMap.renderer.root);
                        }
                    }
                    
                    failCount++;
                }
            } catch (error) {
                this.debugError(`× 添加关联线失败 (${link.from} -> ${link.to}):`, error);
                failCount++;
            }
        }

        this.debugLog(`\n关联线添加完成: 成功 ${successCount} 条, 失败 ${failCount} 条`);
        
        // 重新渲染所有关联线
        try {
            if (mindMap.associativeLine && typeof mindMap.associativeLine.renderAllLines === 'function') {
                mindMap.associativeLine.renderAllLines();
                this.debugLog('✓ 已调用 renderAllLines 重新渲染关联线');
            }
        } catch (error) {
            this.debugError('× 渲染关联线失败:', error);
        }
        
        // 设置关联线为只读（不可编辑）
        try {
            if (mindMap.associativeLine) {
                // 尝试设置只读属性
                if ('readonly' in mindMap.associativeLine) {
                    mindMap.associativeLine.readonly = true;
                    this.debugLog('✓ 已设置关联线为只读模式');
                } else {
                    this.debugLog('ⓘ 关联线插件不支持 readonly 属性');
                }
            }
        } catch (error) {
            this.debugError('× 设置只读模式失败:', error);
        }
    }

    /**
     * 处理拖拽结束事件（由 simple-mind-map 的 Drag 插件调用）
     */
    private async handleDragEnd({ overlapNodeUid, prevNodeUid, nextNodeUid, beingDragNodeList }: any): Promise<boolean> {
        this.debugLog('拖拽结束:', { overlapNodeUid, prevNodeUid, nextNodeUid, beingDragNodeList });

        // 只处理单节点拖拽
        if (beingDragNodeList.length !== 1) {
            this.debugLog('多节点拖拽，暂不同步到思源');
            return false; // 允许默认拖拽
        }

        const draggedNode = beingDragNodeList[0];
        const draggedData = draggedNode.getData();
        
        // 获取拖拽前的父节点
        const originalParent = draggedNode.parent;
        const originalParentData = originalParent ? originalParent.getData() : null;
        
        this.debugLog('拖拽节点数据:', draggedData);
        this.debugLog('原父节点数据:', originalParentData);

        // 检查是否可以移动
        if (draggedData.isWorkspace || draggedData.isNotebook) {
            showMessage('不能移动工作空间或笔记本节点', 3000, 'error');
            return true; // 取消默认拖拽
        }

        // 推断新的父节点
        let newParentNode = null;
        let newParentData = null;

        if (overlapNodeUid) {
            // 拖拽到某个节点上
            newParentNode = this.mindMap.renderer.findNodeByUid(overlapNodeUid);
            newParentData = newParentNode ? newParentNode.getData() : null;
            this.debugLog('拖拽到节点上，目标节点:', newParentData);
        } else if (prevNodeUid || nextNodeUid) {
            // 拖拽到节点之间，通过前后节点推断父节点
            const refNodeUid = prevNodeUid || nextNodeUid;
            const refNode = this.mindMap.renderer.findNodeByUid(refNodeUid);
            if (refNode && refNode.parent) {
                newParentNode = refNode.parent;
                newParentData = newParentNode.getData();
                this.debugLog('拖拽到节点之间，推断的父节点:', newParentData);
            }
        }

        // 如果无法确定新父节点，允许默认拖拽
        if (!newParentData) {
            this.debugLog('无法确定新父节点，允许默认拖拽');
            return false;
        }

        // 检查新父节点是否合法
        if (newParentData.isWorkspace) {
            showMessage('不能将文档移动到工作空间节点下', 3000, 'error');
            return true; // 取消默认拖拽
        }

        // 检查父节点是否发生变化
        const originalParentUid = originalParentData ? originalParentData.uid : null;
        const newParentUid = newParentData.uid;
        
        if (originalParentUid === newParentUid) {
            this.debugLog('父节点未发生变化，只是调整顺序，允许默认拖拽');
            return false; // 允许默认拖拽
        }

        // 父节点发生变化，同步到思源
        try {
            const dragDocId = draggedData.id;
            const targetNotebookId = newParentData.notebookId;
            
            this.debugLog('=== 开始移动文档（父节点变化） ===');
            this.debugLog('拖拽节点:', draggedData.text);
            this.debugLog('原父节点:', originalParentData ? originalParentData.text : 'null');
            this.debugLog('新父节点:', newParentData.text);
            
            // 确定目标文档 ID
            let targetDocId: string | null = null;
            
            if (newParentData.isNotebook) {
                // 如果新父节点是笔记本，移动到笔记本根目录
                targetDocId = null;
                this.debugLog('移动到笔记本根目录');
            } else {
                // 如果新父节点是文档，移动到该文档下
                targetDocId = newParentData.id;
                this.debugLog('移动到文档下，目标文档ID:', targetDocId);
            }

            // 调用API移动文档
            await api.moveDocToParent(dragDocId, targetDocId, targetNotebookId);
            
            showMessage(`文档 "${draggedData.text}" 已移动到 "${newParentData.text}" 下`, 2000, 'info');

            return false; // 允许默认拖拽效果
        } catch (error) {
            this.debugError('移动文档失败:', error);
            showMessage('移动文档失败: ' + error.message, 5000, 'error');
            return true; // 取消默认拖拽
        }
    }


    /**
     * 刷新思维导图
     */
    async refreshMindMap() {
        if (this.mindMap) {
            try {
                showMessage('正在刷新思维导图...', 1000, 'info');
                const docTree = await this.buildDocTreeMindMap();
                
                // 清除旧的关联线
                if (this.mindMap.associativeLine && typeof this.mindMap.associativeLine.clearAllLines === 'function') {
                    this.mindMap.associativeLine.clearAllLines();
                    this.debugLog('已清除旧的关联线');
                }
                
                this.mindMap.setData(docTree);
                this.mindMap.render();
                
                // 重新初始化节点映射
                this.lastNodeMap = this.updateNodeMap(this.mindMap.getData());
                this.debugLog('思维导图已刷新，节点数量:', this.lastNodeMap.size);
                
                // 重新添加关联线（根据复选框状态决定）
                setTimeout(async () => {
                    const showAssociativeLine = this.settingUtils.get(showAssociativeLineName) !== false;
                    if (showAssociativeLine) {
                        await this.loadAssociativeLines(docTree, false);
                    }
                    showMessage('思维导图已刷新', 1500, 'info');
                }, 1000);
                
            } catch (error) {
                this.debugError('刷新思维导图失败:', error);
                showMessage('刷新思维导图失败: ' + error.message, 3000, 'error');
            }
        }
    }

    async openDocTreeDialog() {
        this.initDarkTheme();

        try {
            // 构建文档树
            const docTree = await this.buildDocTreeMindMap();
            
            
        const dialog = new Dialog({
                title: `${this.i18n.actionName} - ${docTree.data.text}`,
            content: `
                    <div class="mind-map-container" style="width: 100%; height: 100%; position: relative;">
                        <div class="mind-map-toolbar" style="position: absolute; top: 10px; right: 10px; z-index: 1000; display: flex; gap: 8px; background: var(--b3-theme-background); padding: 8px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                            <button id="treeAddChildBtn" class="b3-button b3-button--outline" title="添加子节点 (Tab)">
                                <svg><use xlink:href="#iconAdd"></use></svg>
                                <span style="margin-left: 4px;">子节点</span>
                            </button>
                            <button id="treeAddSiblingBtn" class="b3-button b3-button--outline" title="添加兄弟节点 (Enter)">
                                <svg><use xlink:href="#iconAdd"></use></svg>
                                <span style="margin-left: 4px;">兄弟</span>
                            </button>
                            <button id="treeDeleteNodeBtn" class="b3-button b3-button--outline" title="删除节点 (Delete)">
                                <svg><use xlink:href="#iconTrashcan"></use></svg>
                                <span style="margin-left: 4px;">删除</span>
                            </button>
                            <div style="width: 1px; background: var(--b3-border-color);"></div>
                            <button id="treeThemeBtn" class="b3-button b3-button--outline" title="切换主题">
                                <svg><use xlink:href="#iconTheme"></use></svg>
                                <span style="margin-left: 4px;">主题</span>
                            </button>
                            <button id="refreshBtn" class="b3-button b3-button--outline" title="刷新思维导图">
                                <svg><use xlink:href="#iconRefresh"></use></svg>
                                <span style="margin-left: 4px;">刷新</span>
                            </button>
                            <label id="showAssociativeLineLabel" class="b3-button b3-button--outline" style="display: flex; align-items: center; cursor: pointer; margin: 0;" title="显示/隐藏文档链接">
                                <input type="checkbox" id="showAssociativeLineCheckbox" style="margin: 0 4px 0 0;">
                                <span>关联线</span>
                            </label>
                            <div style="width: 1px; background: var(--b3-border-color);"></div>
                            <button id="treeExportBtn" class="b3-button b3-button--outline" title="导出思维导图">
                                <svg><use xlink:href="#iconUpload"></use></svg>
                                <span style="margin-left: 4px;">导出</span>
                            </button>
                        </div>
                        <div id="mindMapContainer" style="width: 100%; height: 100%;"></div>
                        </div>
                        `,
            width: '95vw',
            height: '95vh',
            destroyCallback: () => {
                    if (this.mindMap) {
                        this.mindMap.destroy();
                        this.mindMap = null;
                    }
                    // 清理节点映射
                    this.lastNodeMap.clear();
                    // 重置初始化标志
                    this.isInitializing = false;
                }
            });
            
            // 等待DOM渲染
            setTimeout(() => {
                const container = dialog.element.querySelector("#mindMapContainer");
                if (!container) {
                    showMessage('无法找到思维导图容器', 3000, 'error');
                    return;
                }

                // 获取展开层级配置
                const expandLevel = this.settingUtils.get(docTreeExpandLevelName) ?? 3;
                this.debugLog('文档树思维导图展开层级:', expandLevel);
                
                // 获取主题配置
                const themeName = this.settingUtils.get(docTreeThemeName) || 'default';
                this.debugLog('文档树思维导图主题:', themeName);
                
                // 预处理数据：根据展开层级设置节点展开状态
                this.setNodeExpandState(docTree, expandLevel, 0);
                
                // 创建思维导图实例
                this.mindMap = new MindMap({
                    el: container,
                    data: docTree,
                    // 布局配置
                    layout: 'logicalStructure', // 逻辑结构图
                    // 应用主题
                    theme: themeName,
                    // 禁用自由拖拽（只是改变位置，不改变层级）
                    enableFreeDrag: false,
                    // 启用只读模式为 false，允许拖拽
                    readonly: false,
                    // 导出配置
                    exportPaddingX: 100, // 导出时的左右边距
                    exportPaddingY: 100, // 导出时的上下边距
                    // 拖拽钩子 - 拦截拖拽结束事件
                    beforeDragEnd: async (data: any) => {
                        return await this.handleDragEnd(data);
                    },
                } as any);
                
                // 检查 AssociativeLine 插件是否已加载
                this.debugLog('MindMap 实例创建完成');
                this.debugLog('associativeLine 插件是否存在:', !!this.mindMap.associativeLine);
                if (this.mindMap.associativeLine) {
                    this.debugLog('associativeLine 可用方法:', Object.keys(this.mindMap.associativeLine));
                }
                this.debugLog('文档树展开层级已预设:', expandLevel);

                
                // 监听节点创建事件
                this.bindNodeCreateEvent();
                
                // 监听节点点击事件（Ctrl+左键打开文档）
                this.bindNodeClickEvent();
                
                // 绑定工具栏事件
                this.bindToolbarEvents();
                
                // 初始化关联线复选框状态
                const showAssociativeLine = this.settingUtils.get(showAssociativeLineName) !== false;
                const checkbox = document.getElementById('showAssociativeLineCheckbox') as HTMLInputElement;
                if (checkbox) {
                    checkbox.checked = showAssociativeLine;
                }
                
                // 添加文档之间的关联线（根据配置决定是否加载）
                if (showAssociativeLine) {
                    setTimeout(async () => {
                        await this.loadAssociativeLines(docTree, true);
                    }, 1500);
                }
                
            }, 100);
            
        } catch (error) {
            this.debugError("打开文档树思维导图失败:", error);
            showMessage("打开文档树思维导图失败: " + error.message, 5000, "error");
        }
    }

    async onunload() {
        // 断开文档变化监听器
        if (this.documentObserver) {
            this.documentObserver.disconnect();
            this.documentObserver = null;
        }
        
        // 清理主思维导图实例
        if (this.mindMap) {
            this.mindMap.destroy();
            this.mindMap = null;
        }
        
        // 清理文档思维导图实例
        if (this.docMindMap) {
            this.docMindMap.destroy();
            this.docMindMap = null;
        }
        
        // 清理所有嵌入的思维导图实例
        this.embeddedMindMaps.forEach((mindMap) => {
            if (mindMap) {
                mindMap.destroy();
            }
        });
        this.embeddedMindMaps.clear();
        
        // 清理节点映射
        this.lastNodeMap.clear();
        
        // 清理暗黑模式样式类
        this.cleanDarkModeClass();
    }

    /**
     * 插件卸载时清理配置文件
     */
    async uninstall() {
        // 删除插件配置文件
        try {
            if (this.settingUtils && this.settingUtils.file) {
                // 删除配置文件
                await this.removeData(this.settingUtils.file);
                this.debugLog('插件配置文件已删除');
            }
        } catch (error) {
            this.debugError('删除配置文件失败:', error);
        }
    }

    private initDarkTheme() {
        let html = document.documentElement;
        if (html.getAttribute('data-theme-mode')==="dark"){
            html.classList.add(darkModeClassName);
        }else {
            this.cleanDarkModeClass();
        }
    }

    private cleanDarkModeClass() {
        document.documentElement.classList.remove(darkModeClassName);
    }

    /**
     * 监听节点点击事件（Ctrl+左键打开文档）
     */
    bindNodeClickEvent() {
        if (!this.mindMap) return;
        
        // 监听节点左键点击事件（Ctrl+点击）
        this.mindMap.on('node_click', (node: any, e: MouseEvent) => {
            if (e.ctrlKey || e.metaKey) { // Ctrl键（Windows/Linux）或 Cmd键（Mac）
                e.preventDefault();
                e.stopPropagation();
                this.handleNodeOpenDocument(node);
            }
        });
        
    }
    
    /**
     * 处理打开节点对应的文档
     * @param node 被点击的节点
     */
    async handleNodeOpenDocument(node: any) {
        try {
            const nodeData = node.getData();
            
            // 检查节点是否有对应的文档
            if (!nodeData.id) {
                showMessage('该节点没有对应的文档', 2000, 'info');
                return;
            }
            
            // 检查是否是系统节点
            if (nodeData.isWorkspace || nodeData.isRoot) {
                showMessage('工作空间节点无法打开', 2000, 'info');
                return;
            }
            
            if (nodeData.isNotebook) {
                showMessage('请选择具体的文档节点', 2000, 'info');
                return;
            }
            
            // 使用思源笔记的 openTab API
            openTab({
                app: this.app,
                doc: {
                    id: nodeData.id,
                    zoomIn: false
                }
            });
            
            showMessage(`已打开文档: ${nodeData.text}`, 1500, 'info');
            
        } catch (error) {
            this.debugError('打开文档失败:', error);
            showMessage(`打开文档失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 监听节点创建事件
     */
    bindNodeCreateEvent() {
        if (!this.mindMap) return;
        
        // 标记正在初始化
        this.isInitializing = true;
        
        // 初始化节点映射
        this.lastNodeMap = this.updateNodeMap(this.mindMap.getData());
        
        // 监听 data_change 事件
        this.mindMap.on('data_change', async (data: any) => {
            await this.detectAndHandleNodeChanges(data);
        });
        
        // 延迟结束初始化标志，等待 simple-mind-map 完成初始渲染和 HTML 解码
        // 这样可以避免初始渲染时的文本变化（HTML解码）被误识别为重命名操作
        setTimeout(() => {
            // 重新更新节点映射，使用渲染后（HTML解码后）的文本
            this.lastNodeMap = this.updateNodeMap(this.mindMap.getData());
            // 结束初始化标志
            this.isInitializing = false;
            this.debugLog('文档树思维导图初始化完成，开始监听节点变化');
        }, 1000);
        
    }
    
    /**
     * 更新节点映射表
     */
    updateNodeMap(data: any) {
        const newMap = new Map<string, any>();
        
        const traverse = (node: any) => {
            if (node && node.data && node.data.uid) {
                // 去除 HTML 标签，只保留纯文本
                const cleanText = this.stripHtmlTags(node.data.text);
                
                newMap.set(node.data.uid, {
                    text: cleanText,  // 使用去除 HTML 后的纯文本
                    id: node.data.id,
                    notebookId: node.data.notebookId,
                    isNotebook: node.data.isNotebook,
                    isWorkspace: node.data.isWorkspace,
                    isRoot: node.data.isRoot,
                    hpath: node.data.hpath,
                    path: node.data.path
                });
            }
            if (node.children && node.children.length > 0) {
                node.children.forEach((child: any) => traverse(child));
            }
        };
        
        if (data) {
            traverse(data);
        }
        
        return newMap;
    }
    
    /**
     * 检测并处理节点变化（新建、删除和重命名）
     */
    async detectAndHandleNodeChanges(data: any) {
        // 【关键修复】如果文档思维导图对话框正在打开，不处理文档树的变化
        // 防止文档思维导图的操作误触发文档树的重命名逻辑
        if (this.docMindMap) {
            return;
        }
        
        // 【关键修复】如果正在初始化，不处理节点变化
        // 防止 simple-mind-map 渲染时的 HTML 解码导致所有节点被误识别为重命名
        if (this.isInitializing) {
            return;
        }
        
        const currentNodeMap = this.updateNodeMap(data);
        
        // 检测新增节点，并等待所有创建操作完成
        const createPromises = [];
        for (const [uid, nodeInfo] of currentNodeMap.entries()) {
            if (!this.lastNodeMap.has(uid)) {
                // 找到完整的节点数据（包含父节点信息）
                const fullNodeData = this.findNodeByUid(data, uid);
                if (fullNodeData) {
                    // 收集所有创建操作的 Promise
                    const createPromise = this.handleNodeCreate(fullNodeData).then(() => {
                        // 创建完成后，将更新后的信息同步到 currentNodeMap
                        if (this.lastNodeMap.has(uid)) {
                            const updatedInfo = this.lastNodeMap.get(uid);
                            currentNodeMap.set(uid, updatedInfo);
                        }
                    });
                    createPromises.push(createPromise);
                }
            }
        }
        
        // 等待所有新建节点的创建操作完成
        if (createPromises.length > 0) {
            await Promise.all(createPromises);
        }
        
        // 检测重命名节点
        const renamedNodes = [];
        for (const [uid, currentNodeInfo] of currentNodeMap.entries()) {
            const lastNodeInfo = this.lastNodeMap.get(uid);
            if (lastNodeInfo && lastNodeInfo.text !== currentNodeInfo.text) {
                
                // 合并节点信息，使用 lastNodeMap 中的完整信息（id, notebookId, path等）
                // 但使用 currentNodeMap 中的新文本
                const mergedNewNodeInfo = {
                    ...lastNodeInfo,  // 保留 id, notebookId, path 等信息
                    text: currentNodeInfo.text  // 使用新的文本
                };
                
                renamedNodes.push({
                    uid,
                    oldNodeInfo: lastNodeInfo,
                    newNodeInfo: mergedNewNodeInfo  // 使用合并后的完整信息
                });
            }
        }
        
        // 处理重命名的节点
        if (renamedNodes.length > 0) {
            await this.handleNodesRename(renamedNodes);
        }
        
        // 检测删除节点
        const deletedNodes = [];
        for (const [uid, nodeInfo] of this.lastNodeMap.entries()) {
            if (!currentNodeMap.has(uid)) {
                // 这是一个被删除的节点
                deletedNodes.push({ uid, nodeInfo });
            }
        }
        
        // 处理删除的节点
        if (deletedNodes.length > 0) {
            await this.handleNodesDelete(deletedNodes);
        }
        
        // 更新 lastNodeMap，但要避免丢失已经设置的文档信息
        const oldLastNodeMap = new Map(this.lastNodeMap);
        this.lastNodeMap = currentNodeMap;
        
        // 恢复之前创建文档时设置的信息
        for (const [uid, oldInfo] of oldLastNodeMap.entries()) {
            if (this.lastNodeMap.has(uid) && oldInfo.id) {
                const currentInfo = this.lastNodeMap.get(uid);
                // 如果当前信息没有ID，但旧信息有ID，则保留旧信息的完整数据
                if (!currentInfo.id && oldInfo.id) {
                    currentInfo.id = oldInfo.id;
                    currentInfo.notebookId = oldInfo.notebookId;
                    currentInfo.path = oldInfo.path;
                    this.lastNodeMap.set(uid, currentInfo);
                }
            }
        }
    }
    
    /**
     * 通过 uid 查找节点
     */
    findNodeByUid(data: any, uid: string, parent: any = null): any {
        if (!data) return null;
        
        if (data.data && data.data.uid === uid) {
            // 找到节点，但需要确保父节点信息完整
            let enhancedParent = parent;
            if (parent && parent.data && parent.data.uid) {
                // 尝试从 lastNodeMap 获取父节点的完整信息
                const parentInfo = this.lastNodeMap.get(parent.data.uid);
                if (parentInfo) {
                    // 合并父节点信息，优先使用 lastNodeMap 中的完整数据
                    enhancedParent = {
                        ...parent,
                        data: {
                            ...parent.data,
                            id: parentInfo.id || parent.data.id,
                            notebookId: parentInfo.notebookId || parent.data.notebookId,
                            path: parentInfo.path || parent.data.path,
                            hpath: parentInfo.hpath || parent.data.hpath
                        }
                    };
                    this.debugLog(`增强父节点 ${parent.data.uid} 的信息:`, {
                        原始: parent.data,
                        增强后: enhancedParent.data
                    });
                }
            }
            
            return {
                ...data,
                parent: enhancedParent
            };
        }
        
        if (data.children && data.children.length > 0) {
            for (const child of data.children) {
                const result = this.findNodeByUid(child, uid, data);
                if (result) return result;
            }
        }
        
        return null;
    }
    
    /**
     * 处理节点重命名
     * @param renamedNodes 重命名的节点列表
     */
    async handleNodesRename(renamedNodes: Array<{uid: string, oldNodeInfo: any, newNodeInfo: any}>) {
        try {
            this.debugLog('=== 开始处理节点重命名 ===');
            
            // 过滤出需要重命名文档的节点（排除工作空间、笔记本等）
            const docsToRename = renamedNodes.filter(({newNodeInfo}) => {
                const hasId = !!newNodeInfo.id;
                const hasNotebookId = !!newNodeInfo.notebookId;
                const hasPath = !!newNodeInfo.path;
                const isNotSystemNode = !newNodeInfo.isWorkspace && !newNodeInfo.isNotebook && !newNodeInfo.isRoot;
                return hasId && hasNotebookId && hasPath && isNotSystemNode;
            });
            
            if (docsToRename.length === 0) {
                this.debugLog('没有需要重命名的文档');
                return;
            }
            
            this.debugLog('需要重命名的文档节点:', docsToRename);
            
            // 执行重命名操作
            let successCount = 0;
            let failureCount = 0;
            
            for (const {oldNodeInfo, newNodeInfo} of docsToRename) {
                try {
                    // 再次确保文本是纯文本（去除可能的 HTML 标签）
                    const cleanNewText = this.stripHtmlTags(newNodeInfo.text);
                    const cleanOldText = this.stripHtmlTags(oldNodeInfo.text);
                    
                    // 如果去除 HTML 后文本没有变化，跳过重命名
                    if (cleanNewText === cleanOldText) {
                        this.debugLog(`跳过重命名（纯文本相同）: "${cleanNewText}"`);
                        continue;
                    }
                    
                    this.debugLog(`重命名文档: "${cleanOldText}" -> "${cleanNewText}" (${newNodeInfo.id})`);
                    
                    // 调用重命名文档API，使用纯文本
                    if (newNodeInfo.notebookId && newNodeInfo.path && cleanNewText) {
                        const result = await api.renameDoc(
                            newNodeInfo.notebookId, 
                            newNodeInfo.path, 
                            cleanNewText  // 使用去除 HTML 后的纯文本
                        );
                        this.debugLog(`文档重命名成功: "${cleanOldText}" -> "${cleanNewText}"`);
                        successCount++;
                    } else {
                        this.debugWarn(`文档信息不完整，跳过重命名: ${newNodeInfo.text}`, {
                            notebookId: newNodeInfo.notebookId,
                            path: newNodeInfo.path
                        });
                        failureCount++;
                    }
                } catch (error) {
                    this.debugError(`重命名文档失败: "${oldNodeInfo.text}" -> "${newNodeInfo.text}"`, error);
                    failureCount++;
                }
            }
            
            // 显示重命名结果
            if (successCount > 0) {
                showMessage(`成功重命名 ${successCount} 个文档`, 2000, 'info');
            }
            if (failureCount > 0) {
                showMessage(`${failureCount} 个文档重命名失败`, 3000, 'error');
            }
            
            this.debugLog('=== 节点重命名处理完成 ===');
            
        } catch (error) {
            this.debugError('处理节点重命名失败:', error);
            showMessage(`重命名文档失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 处理节点删除
     * @param deletedNodes 被删除的节点列表
     */
    async handleNodesDelete(deletedNodes: Array<{uid: string, nodeInfo: any}>) {
        try {
            this.debugLog('=== 开始处理节点删除 ===');
            
            // 过滤出需要删除文档的节点（排除工作空间、笔记本等）
            const docsToDelete = deletedNodes.filter(({nodeInfo}) => {
                return nodeInfo.id && !nodeInfo.isWorkspace && !nodeInfo.isNotebook && !nodeInfo.isRoot;
            });
            
            if (docsToDelete.length === 0) {
                this.debugLog('没有需要删除的文档');
                return;
            }
            
            this.debugLog('需要删除的文档节点:', docsToDelete);
            
            // 构建删除确认消息
            const docNames = docsToDelete.map(({nodeInfo}) => nodeInfo.text).join('、');
            const confirmMessage = docsToDelete.length === 1 
                ? `确定要删除文档 "${docNames}" 及其所有子文档吗？\n\n⚠️ 此操作不可撤销！`
                : `确定要删除以下 ${docsToDelete.length} 个文档及其所有子文档吗？\n\n${docNames}\n\n⚠️ 此操作不可撤销！`;
            
            // 显示确认对话框
            const confirmed = await this.showDeleteConfirmDialog(confirmMessage);
            
            if (!confirmed) {
                this.debugLog('用户取消删除操作');
                showMessage('已取消删除操作', 2000, 'info');
                return;
            }
            
            // 执行删除操作
            let successCount = 0;
            let failureCount = 0;
            
            for (const {nodeInfo} of docsToDelete) {
                try {
                    this.debugLog(`删除文档: ${nodeInfo.text} (${nodeInfo.id})`);
                    
                    // 调用删除文档API
                    // 注意：removeDoc 需要 notebook 和 path 参数
                    if (nodeInfo.notebookId && nodeInfo.path) {
                        await api.removeDoc(nodeInfo.notebookId, nodeInfo.path);
                        this.debugLog(`文档删除成功: ${nodeInfo.text}`);
                        successCount++;
                    } else {
                        this.debugWarn(`文档信息不完整，跳过删除: ${nodeInfo.text}`, nodeInfo);
                        failureCount++;
                    }
                } catch (error) {
                    this.debugError(`删除文档失败: ${nodeInfo.text}`, error);
                    failureCount++;
                }
            }
            
            // 显示删除结果
            if (successCount > 0) {
                showMessage(`成功删除 ${successCount} 个文档`, 2000, 'info');
            }
            if (failureCount > 0) {
                showMessage(`${failureCount} 个文档删除失败`, 3000, 'error');
            }
            
            this.debugLog('=== 节点删除处理完成 ===');
            
        } catch (error) {
            this.debugError('处理节点删除失败:', error);
            showMessage(`删除文档失败: ${error.message}`, 3000, 'error');
        }
    }
    
    /**
     * 显示删除确认对话框
     * @param message 确认消息
     * @returns Promise<boolean> 用户是否确认删除
     */
    async showDeleteConfirmDialog(message: string): Promise<boolean> {
        return new Promise((resolve) => {
            const dialog = new Dialog({
                title: "确认删除",
                content: `
                    <div style="padding: 20px; text-align: center;">
                        <div style="margin-bottom: 20px; color: #d73a49; font-size: 24px;">
                            ⚠️
                        </div>
                        <div style="margin-bottom: 20px; white-space: pre-line; line-height: 1.5;">
                            ${message}
                        </div>
                        <div style="display: flex; gap: 10px; justify-content: center;">
                            <button id="confirmDelete" class="b3-button b3-button--cancel" style="background-color: #d73a49; color: white;">
                                确认删除
                            </button>
                            <button id="cancelDelete" class="b3-button b3-button--cancel">
                                取消
                            </button>
                        </div>
                    </div>
                `,
                width: "400px",
                height: "auto",
                destroyCallback: () => {
                    resolve(false); // 如果直接关闭对话框，视为取消
                }
            });
            
            // 绑定按钮事件
            setTimeout(() => {
                const confirmBtn = dialog.element.querySelector('#confirmDelete') as HTMLButtonElement;
                const cancelBtn = dialog.element.querySelector('#cancelDelete') as HTMLButtonElement;
                
                if (confirmBtn) {
                    confirmBtn.addEventListener('click', () => {
                        dialog.destroy();
                        resolve(true);
                    });
                }
                
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', () => {
                        dialog.destroy();
                        resolve(false);
                    });
                }
            }, 100);
        });
    }

    /**
     * 处理新节点创建
     * @param nodeData 新创建的节点数据
     */
    async handleNodeCreate(nodeData: any) {
        try {
            this.debugLog('=== 开始处理新节点创建 ===');
            this.debugLog('节点完整数据:', JSON.stringify(nodeData, null, 2));
            
            // 获取节点的基本信息，并去除 HTML 标签
            const rawNodeName = nodeData.data?.text;
            const nodeName = this.stripHtmlTags(rawNodeName);  // 去除 HTML 标签
            const nodeUid = nodeData.data?.uid;
            const parentNodeData = nodeData.parent?.data;
            
            this.debugLog('节点原始名称:', rawNodeName);
            this.debugLog('节点纯文本名称:', nodeName);
            this.debugLog('节点UID:', nodeUid);
            this.debugLog('父节点数据:', parentNodeData);
            
            if (!nodeName || nodeName.trim() === '') {
                this.debugLog('节点名称为空，跳过创建文档');
                return;
            }
            
            if (!parentNodeData) {
                this.debugLog('父节点不存在，跳过创建文档');
                return;
            }
            
            // 跳过工作空间根节点
            if (parentNodeData.isWorkspace || parentNodeData.isRoot) {
                this.debugLog('父节点是工作空间或根节点，跳过创建文档');
                return;
            }
            
            // 如果节点已经有ID，说明不是新创建的，可能是从现有文档加载的
            if (nodeData.data?.id) {
                this.debugLog('节点已有文档ID，跳过创建:', nodeData.data.id);
                return;
            }
            
            // 获取笔记本ID
            let notebookId = parentNodeData.notebookId;
            if (!notebookId) {
                this.debugLog('无法确定笔记本ID，跳过创建文档');
                return;
            }
            
            // 确定父文档路径和创建路径
            let newDocPath: string;
            
            if (parentNodeData.isNotebook) {
                // 如果父节点是笔记本，创建在笔记本根目录
                newDocPath = `/${nodeName}`;
                this.debugLog('在笔记本根目录创建文档，路径:', newDocPath);
            } else if (parentNodeData.id) {
                // 如果父节点是文档，需要获取其层级路径
                try {
                    this.debugLog('获取父文档的层级路径...');
                    const parentHPath = await api.getHPathByID(parentNodeData.id);
                    this.debugLog('父文档层级路径:', parentHPath);
                    
                    // 使用层级路径构建新文档路径
                    newDocPath = `${parentHPath}/${nodeName}`;
                    this.debugLog('使用父文档层级路径构建:', newDocPath);
                } catch (error) {
                    this.debugWarn('获取父文档层级路径失败，使用备用方案:', error);
                    // 备用方案：直接使用父文档ID
                    newDocPath = `/${parentNodeData.id}/${nodeName}`;
                    this.debugLog('备用路径（使用ID）:', newDocPath);
                }
                
                this.debugLog('父文档信息:', {
                    id: parentNodeData.id,
                    text: parentNodeData.text,
                    hpath: parentNodeData.hpath,
                    path: parentNodeData.path
                });
            } else {
                this.debugLog('父节点信息不完整，跳过创建文档');
                return;
            }
            
            this.debugLog('准备创建文档:', {
                notebookId,
                path: newDocPath,
                nodeName
            });
            
            // 调用API创建文档
            const result = await api.createDocWithMd(
                notebookId,
                newDocPath,
                `# ${nodeName}\n\n`
            );
            
            this.debugLog('文档创建成功，返回结果:', result);
            showMessage(`已创建文档: ${nodeName}`, 2000, 'info');
            
            // 更新节点数据，添加新创建文档的ID
            if (result && typeof result === 'string') {
                // result 就是新文档的 ID
                const newDocId = result;
                nodeData.data.id = newDocId;
                nodeData.data.notebookId = notebookId;
                
                // 构建新文档的正确路径（使用父文档的ID路径 + 新文档ID）
                let actualDocPath: string;
                if (parentNodeData.isNotebook) {
                    // 如果父节点是笔记本，路径就是 /新文档ID.sy
                    actualDocPath = `/${newDocId}.sy`;
                } else {
                    // 如果父节点是文档，路径是 父文档路径去掉.sy + /新文档ID.sy
                    const parentBasePath = parentNodeData.path.replace('.sy', '');
                    actualDocPath = `${parentBasePath}/${newDocId}.sy`;
                }
                
                nodeData.data.path = actualDocPath;
                
                this.debugLog('已更新节点数据，文档ID:', newDocId, '路径:', actualDocPath);
                
                // 立即更新 lastNodeMap，确保后续操作能获取到完整信息
                if (this.lastNodeMap.has(nodeUid)) {
                    const nodeInfo = this.lastNodeMap.get(nodeUid);
                    nodeInfo.id = newDocId;
                    nodeInfo.notebookId = notebookId;
                    nodeInfo.path = actualDocPath;
                    this.lastNodeMap.set(nodeUid, nodeInfo);
                    this.debugLog('已更新 lastNodeMap 中的节点信息:', nodeInfo);
                } else {
                    // 如果节点不存在于 lastNodeMap 中，直接添加
                    const newNodeInfo = {
                        text: nodeName,
                        id: newDocId,
                        notebookId: notebookId,
                        path: actualDocPath,
                        isNotebook: false,
                        isWorkspace: false,
                        isRoot: false,
                        hpath: undefined
                    };
                    this.lastNodeMap.set(nodeUid, newNodeInfo);
                    this.debugLog('新增 lastNodeMap 中的节点信息:', newNodeInfo);
                }
            }
            
            this.debugLog('=== 节点创建处理完成 ===');
            
        } catch (error) {
            this.debugError('创建文档失败:', error);
            showMessage(`创建文档失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 绑定工具栏事件
     */
    bindToolbarEvents() {
        // 添加子节点
        const addChildBtn = document.getElementById('treeAddChildBtn');
        if (addChildBtn) {
            addChildBtn.addEventListener('click', () => {
                const activeNodes = this.mindMap.renderer.activeNodeList;
                if (activeNodes.length === 0) {
                    showMessage('请先选择一个节点', 2000, 'info');
                    return;
                }
                const node = activeNodes[0];
                this.mindMap.execCommand('INSERT_CHILD_NODE', true, [], {text: '新子节点'});
                showMessage('已添加子节点，双击可编辑', 2000, 'info');
            });
        }

        // 添加兄弟节点
        const addSiblingBtn = document.getElementById('treeAddSiblingBtn');
        if (addSiblingBtn) {
            addSiblingBtn.addEventListener('click', () => {
                const activeNodes = this.mindMap.renderer.activeNodeList;
                if (activeNodes.length === 0) {
                    showMessage('请先选择一个节点', 2000, 'info');
                    return;
                }
                const node = activeNodes[0];
                if (node.isRoot) {
                    showMessage('根节点不能添加兄弟节点', 2000, 'error');
                    return;
                }
                this.mindMap.execCommand('INSERT_NODE', true, [], {text: '新兄弟节点'});
                showMessage('已添加兄弟节点，双击可编辑', 2000, 'info');
            });
        }

        // 删除节点
        const deleteBtn = document.getElementById('treeDeleteNodeBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                const activeNodes = this.mindMap.renderer.activeNodeList;
                if (activeNodes.length === 0) {
                    showMessage('请先选择一个节点', 2000, 'info');
                    return;
                }
                const node = activeNodes[0];
                if (node.isRoot) {
                    showMessage('不能删除根节点', 2000, 'error');
                    return;
                }
                this.mindMap.execCommand('REMOVE_NODE');
                showMessage('已删除节点', 2000, 'info');
            });
        }

        // 刷新按钮
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.refreshMindMap();
            });
        }

        // 主题切换按钮
        const themeBtn = document.getElementById('treeThemeBtn');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                this.showThemeDialog('tree');
            });
        }

        // 导出按钮
        const exportBtn = document.getElementById('treeExportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.showExportDialog('tree');
            });
        }

        // 关联线显示/隐藏复选框
        const showAssociativeLineCheckbox = document.getElementById('showAssociativeLineCheckbox') as HTMLInputElement;
        if (showAssociativeLineCheckbox) {
            showAssociativeLineCheckbox.addEventListener('change', async (e) => {
                const isChecked = (e.target as HTMLInputElement).checked;
                
                // 保存配置
                this.settingUtils.set(showAssociativeLineName, isChecked);
                
                if (isChecked) {
                    // 显示关联线
                    showMessage('正在加载关联线...', 1000, 'info');
                    
                    // 获取当前文档树数据
                    const docTree = this.mindMap.getData();
                    
                    // 加载关联线
                    await this.loadAssociativeLines(docTree, true);
                } else {
                    // 隐藏关联线
                    if (this.mindMap.associativeLine && typeof this.mindMap.associativeLine.clearAllLines === 'function') {
                        this.mindMap.associativeLine.clearAllLines();
                        showMessage('已隐藏关联线', 1500, 'info');
                        this.debugLog('已清除所有关联线');
                    }
                }
            });
        }
    }

    /**
     * 设置节点的展开状态（在创建思维导图前调用）
     * @param node 节点数据
     * @param targetLevel 目标展开层级（0表示全部展开，1表示展开1层，以此类推）
     * @param currentLevel 当前层级（0表示根节点）
     */
    private setNodeExpandState(node: MindMapNode, targetLevel: number, currentLevel: number) {
        if (!node) return;
        
        // 根据层级设置展开状态
        if (targetLevel === 0) {
            // 0 表示全部展开
            node.data.expand = true;
        } else if (currentLevel < targetLevel) {
            // 当前层级小于目标层级，展开
            // 例如：targetLevel=3时，currentLevel为0,1,2的节点都展开
            node.data.expand = true;
        } else {
            // 当前层级大于等于目标层级，折叠
            node.data.expand = false;
        }
        
        // 递归处理子节点
        if (node.children && node.children.length > 0) {
            node.children.forEach((child) => {
                this.setNodeExpandState(child, targetLevel, currentLevel + 1);
            });
        }
    }

    /**
     * 展开思维导图到指定层级（在思维导图已创建后调用）
     * @param mindMap 思维导图实例
     * @param level 展开层级（0表示全部展开，1表示展开1层，以此类推）
     */
    private expandToLevel(mindMap: any, level: number) {
        if (!mindMap || !mindMap.renderer || !mindMap.renderer.root) {
            this.debugWarn('思维导图实例或根节点不存在');
            return;
        }
        
        this.debugLog('开始应用展开层级:', level);
        
        // 如果level为0，表示全部展开
        if (level === 0) {
            this.debugLog('展开层级为0，全部展开');
            mindMap.execCommand('EXPAND_ALL');
            return;
        }
        
        // 第一步：先折叠所有节点（确保初始状态一致）
        const collapseAll = (node: any) => {
            if (!node) return;
            
            // 设置节点为折叠状态
            if (node.nodeData && node.nodeData.data) {
                node.nodeData.data.expand = false;
            }
            
            // 递归处理子节点
            if (node.children && node.children.length > 0) {
                node.children.forEach((child: any) => {
                    collapseAll(child);
                });
            }
        };
        
        // 第二步：根据层级展开节点
        const expandToDepth = (node: any, currentLevel: number) => {
            if (!node) return;
            
            // 如果当前层级小于目标层级，展开此节点
            if (currentLevel < level) {
                if (node.nodeData && node.nodeData.data) {
                    node.nodeData.data.expand = true;
                }
                
                // 继续递归处理子节点
                if (node.children && node.children.length > 0) {
                    node.children.forEach((child: any) => {
                        expandToDepth(child, currentLevel + 1);
                    });
                }
            }
        };
        
        // 先折叠所有节点
        collapseAll(mindMap.renderer.root);
        
        // 根节点始终展开
        if (mindMap.renderer.root.nodeData && mindMap.renderer.root.nodeData.data) {
            mindMap.renderer.root.nodeData.data.expand = true;
        }
        
        // 然后从根节点开始展开到指定层级
        // 注意：根节点是第0层，所以从子节点开始是第1层
        if (mindMap.renderer.root.children && mindMap.renderer.root.children.length > 0) {
            mindMap.renderer.root.children.forEach((child: any) => {
                expandToDepth(child, 1);
            });
        }
        
        this.debugLog('展开层级应用完成，重新渲染');
        
        // 重新渲染
        mindMap.render();
    }
    
    /**
     * 获取当前编辑器
     */
    private getEditor() {
        const editors = getAllEditor();
        if (editors.length === 0) {
            showMessage(`请先打开文档`, 6000, "error");
            return null;
        }
        let protyle = getProtyle();
        if (!protyle) {
            showMessage(`无法获取当前编辑器`, 6000, "error");
            return null;
        }
        return { protyle };
    }

    /**
     * 打开文档思维导图对话框
     * 显示当前打开文档的思维导图视图（包括完整的块内容）
     */
    async openDocMindMapDialog() {
        try {
            this.initDarkTheme();

            // 获取当前编辑器
            const editor = this.getEditor();
            if (!editor) {
                return;
            }

            const protyle = editor.protyle;
            const docId = protyle.block.rootID;

            // 获取文档信息
            const docInfoResp = await client.getDocInfo({ id: docId });

            if (!docInfoResp || !docInfoResp.data) {
                showMessage('获取文档信息失败', 3000, 'error');
                return;
            }

            const title: string = docInfoResp.data.name;
            
            showMessage('正在解析文档块结构...', 2000, 'info');

            // 使用新的块解析器，获取完整的文档块结构
            const mindMapData = await parseDocumentBlocksToMindMap(docId, title);

            // 创建对话框
            const dialog = new Dialog({
                title: `${this.i18n.docMindMapActionName} - ${title}`,
                content: `
                    <div class="doc-mind-map-container" style="width: 100%; height: 100%; position: relative;">
                        <div class="doc-mind-map-toolbar" style="position: absolute; top: 10px; right: 10px; z-index: 1000; display: flex; gap: 8px; background: var(--b3-theme-background); padding: 8px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                            <button id="docAddChildBtn" class="b3-button b3-button--outline" title="添加子节点 (Tab)">
                                <svg><use xlink:href="#iconAdd"></use></svg>
                                <span style="margin-left: 4px;">子节点</span>
                            </button>
                            <button id="docAddSiblingBtn" class="b3-button b3-button--outline" title="添加兄弟节点 (Enter)">
                                <svg><use xlink:href="#iconAdd"></use></svg>
                                <span style="margin-left: 4px;">兄弟</span>
                            </button>
                            <button id="docDeleteNodeBtn" class="b3-button b3-button--outline" title="删除节点 (Delete)">
                                <svg><use xlink:href="#iconTrashcan"></use></svg>
                                <span style="margin-left: 4px;">删除</span>
                            </button>
                            <div style="width: 1px; background: var(--b3-border-color);"></div>
                            <button id="docThemeBtn" class="b3-button b3-button--outline" title="切换主题">
                                <svg><use xlink:href="#iconTheme"></use></svg>
                                <span style="margin-left: 4px;">主题</span>
                            </button>
                            <button id="docSaveBtn" class="b3-button b3-button--outline" title="保存到文档 (Ctrl+S)">
                                <svg><use xlink:href="#iconCheck"></use></svg>
                                <span style="margin-left: 4px;">保存</span>
                            </button>
                            <button id="docResetBtn" class="b3-button b3-button--outline" title="重置为原始内容">
                                <svg><use xlink:href="#iconRefresh"></use></svg>
                                <span style="margin-left: 4px;">重置</span>
                            </button>
                            <div style="width: 1px; background: var(--b3-border-color);"></div>
                            <button id="docExportBtn" class="b3-button b3-button--outline" title="导出思维导图">
                                <svg><use xlink:href="#iconUpload"></use></svg>
                                <span style="margin-left: 4px;">导出</span>
                            </button>
                            <button id="docImportBtn" class="b3-button b3-button--outline" title="导入思维导图">
                                <svg><use xlink:href="#iconDownload"></use></svg>
                                <span style="margin-left: 4px;">导入</span>
                            </button>
                        </div>
                        <div id="docMindMapContainer" style="width: 100%; height: 100%;"></div>
                    </div>
                `,
                width: '95vw',
                height: '95vh',
                destroyCallback: () => {
                    if (this.docMindMap) {
                        this.docMindMap.destroy();
                        this.docMindMap = null;
                    }
                }
            });

            // 等待DOM渲染
            setTimeout(() => {
                const container = dialog.element.querySelector("#docMindMapContainer");
                if (!container) {
                    showMessage('无法找到思维导图容器', 3000, 'error');
                    return;
                }

                // 保存原始数据用于重置
                const originalData = JSON.parse(JSON.stringify(mindMapData));
                
                // 获取对话框容器，用于添加插件元素
                const dialogContainer = dialog.element.querySelector('.doc-mind-map-container') as HTMLElement;
                
                // 获取展开层级配置
                const expandLevel = this.settingUtils.get(docMindMapExpandLevelName) ?? 3;
                this.debugLog('文档思维导图展开层级:', expandLevel);
                
                // 获取主题配置
                const themeName = this.settingUtils.get(docMindMapThemeName) || 'default';
                this.debugLog('文档思维导图主题:', themeName);
                
                // 创建思维导图实例
                this.docMindMap = new MindMap({
                    el: container,
                    data: mindMapData,
                    // 布局配置
                    layout: 'logicalStructure', // 逻辑结构图
                    // 应用主题
                    theme: themeName,
                    // 主题配置 - 覆盖部分主题样式以适应文档内容
                    themeConfig: {
                        // 图片相关配置 - 允许不同比例的图片
                        imgMaxWidth: 400, // 图片最大宽度（增大以适应横向图片）
                        imgMaxHeight: 300, // 图片最大高度（保持合理高度）
                        // 节点内边距（针对纯图片节点减少内边距）
                        paddingX: 3, // 水平内边距（进一步减少）
                        paddingY: 3, // 垂直内边距（进一步减少）
                        // 文本边距
                        textContentMargin: 2, // 文本内容之间的间距
                    },
                    // 启用编辑功能
                    readonly: false,
                    // 禁用自由拖拽（保持层级拖拽）
                    enableFreeDrag: false,
                    // 启用节点拖拽改变层级
                    enableCtrlKeyNodeSelection: true, // 启用 Ctrl 多选
                    // 导出配置
                    exportPaddingX: 100, // 导出时的左右边距
                    exportPaddingY: 100, // 导出时的上下边距
                    // NodeImgAdjust 插件配置
                    customInnerElsAppendTo: dialogContainer, // 将插件元素添加到对话框容器中
                    imgResizeBtnSize: 20, // 调整按钮大小
                    minImgResizeWidth: 50, // 最小宽度
                    minImgResizeHeight: 30, // 最小高度（允许横向图片）
                    maxImgResizeWidthInheritTheme: false, // 不继承主题的最大宽高
                    maxImgResizeWidth: 1000, // 最大宽度（增大以支持宽图）
                    maxImgResizeHeight: 800, // 最大高度
                } as any);
                
                // 应用展开层级
                setTimeout(() => {
                    if (expandLevel === -1) {
                        // 全部展开
                        this.docMindMap.execCommand('EXPAND_ALL');
                    } else if (expandLevel >= 0) {
                        // 展开到指定层级
                        this.expandToLevel(this.docMindMap, expandLevel);
                    }
                }, 200);

                // 绑定工具栏事件
                this.bindDocMindMapToolbarEvents(docId, originalData);
                
                // 绑定编辑事件监听
                this.bindDocMindMapEditEvents();
            }, 100);

        } catch (error) {
            this.debugError("打开文档思维导图失败:", error);
            showMessage(`打开文档思维导图失败: ${error.message}`, 5000, "error");
        }
    }

    /**
     * 绑定文档思维导图工具栏事件
     */
    bindDocMindMapToolbarEvents(docId: string, originalData: any) {
        // 添加子节点
        const addChildBtn = document.getElementById('docAddChildBtn');
        if (addChildBtn) {
            addChildBtn.addEventListener('click', () => {
                const activeNodes = this.docMindMap.renderer.activeNodeList;
                if (activeNodes.length === 0) {
                    showMessage('请先选择一个节点', 2000, 'info');
                    return;
                }
                const node = activeNodes[0];
                this.docMindMap.execCommand('INSERT_CHILD_NODE', true, [], {text: '新子节点'});
                showMessage('已添加子节点，双击可编辑', 2000, 'info');
            });
        }

        // 添加兄弟节点
        const addSiblingBtn = document.getElementById('docAddSiblingBtn');
        if (addSiblingBtn) {
            addSiblingBtn.addEventListener('click', () => {
                const activeNodes = this.docMindMap.renderer.activeNodeList;
                if (activeNodes.length === 0) {
                    showMessage('请先选择一个节点', 2000, 'info');
                    return;
                }
                const node = activeNodes[0];
                if (node.isRoot) {
                    showMessage('根节点不能添加兄弟节点', 2000, 'error');
                    return;
                }
                this.docMindMap.execCommand('INSERT_NODE', true, [], {text: '新兄弟节点'});
                showMessage('已添加兄弟节点，双击可编辑', 2000, 'info');
            });
        }

        // 删除节点
        const deleteBtn = document.getElementById('docDeleteNodeBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                const activeNodes = this.docMindMap.renderer.activeNodeList;
                if (activeNodes.length === 0) {
                    showMessage('请先选择一个节点', 2000, 'info');
                    return;
                }
                const node = activeNodes[0];
                if (node.isRoot) {
                    showMessage('不能删除根节点', 2000, 'error');
                    return;
                }
                this.docMindMap.execCommand('REMOVE_NODE');
                showMessage('已删除节点', 2000, 'info');
            });
        }

        // 保存到文档
        const saveBtn = document.getElementById('docSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                await this.showSaveWarningAndSave(docId);
            });
        }

        // 重置
        const resetBtn = document.getElementById('docResetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.docMindMap.setData(JSON.parse(JSON.stringify(originalData)));
                this.docMindMap.render();
                showMessage('已重置为原始内容', 2000, 'info');
            });
        }

        // 主题切换按钮
        const themeBtn = document.getElementById('docThemeBtn');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                this.showThemeDialog('doc');
            });
        }

        // 导出
        const exportBtn = document.getElementById('docExportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.showExportDialog('doc');
            });
        }

        // 导入
        const importBtn = document.getElementById('docImportBtn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                this.showImportDialog();
            });
        }
    }

    /**
     * 绑定文档思维导图编辑事件
     */
    bindDocMindMapEditEvents() {
        if (!this.docMindMap) return;

        // 监听节点拖拽完成事件
        this.docMindMap.on('node_dragend', () => {
            showMessage('节点层级已改变，记得点击保存按钮', 2000, 'info');
        });
    }

    /**
     * 显示保存警告并保存
     */
    async showSaveWarningAndSave(docId: string) {
        // 检查是否显示警告
        const showWarning = this.settingUtils.get(showSaveWarningName);
        
        if (showWarning !== false) {
            // 显示警告对话框
            const dialog = new Dialog({
                title: "⚠️ 保存警告",
                content: `
                    <div class="b3-dialog__content" style="padding: 20px;">
                        <div style="margin-bottom: 16px; line-height: 1.6;">
                            <strong style="color: var(--b3-theme-error);">警告：</strong>
                            将思维导图同步保存至思源文档，将丢失非 Markdown 格式的块，如：
                        </div>
                        <ul style="margin-left: 20px; line-height: 1.8; color: var(--b3-theme-on-surface);">
                            <li>代码块</li>
                            <li>引用块</li>
                            <li>表格</li>
                            <li>其他特殊块类型</li>
                        </ul>
                        <div style="margin-top: 16px; line-height: 1.6;">
                            <strong style="color: var(--b3-theme-primary);">保留内容：</strong>
                        </div>
                        <ul style="margin-left: 20px; line-height: 1.8; color: var(--b3-theme-on-surface);">
                            <li>各级标题块（H1-H6）</li>
                            <li>无序列表块（支持缩进）</li>
                            <li>图片</li>
                            <li>普通段落文本</li>
                        </ul>
                        <div style="margin-top: 20px; padding: 12px; background: var(--b3-theme-background-light); border-radius: 4px; border-left: 3px solid var(--b3-theme-primary);">
                            <label style="display: flex; align-items: center; cursor: pointer;">
                                <input type="checkbox" id="dontShowAgain" style="margin-right: 8px;">
                                <span>不再提示此警告</span>
                            </label>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel">取消</button>
                        <button id="confirmSave" class="b3-button b3-button--text">确认保存</button>
                    </div>
                `,
                width: "500px",
            });

            setTimeout(() => {
                const confirmBtn = document.getElementById('confirmSave');
                const dontShowAgainCheckbox = document.getElementById('dontShowAgain') as HTMLInputElement;
                
                if (confirmBtn) {
                    confirmBtn.addEventListener('click', async () => {
                        // 如果勾选了"不再提示"，保存设置
                        if (dontShowAgainCheckbox && dontShowAgainCheckbox.checked) {
                            await this.settingUtils.set(showSaveWarningName, false);
                        }
                        
                        dialog.destroy();
                        await this.saveDocMindMapToDocument(docId);
                    });
                }
            }, 100);
        } else {
            // 不显示警告，直接保存
            await this.saveDocMindMapToDocument(docId);
        }
    }

    /**
     * 将思维导图保存到文档
     */
    async saveDocMindMapToDocument(docId: string) {
        try {
            showMessage('正在保存到文档...', 2000, 'info');
            
            // 1. 获取思维导图数据
            const data = this.docMindMap.getData();
            
            // 2. 处理图片：将base64图片上传到assets文件夹
            await this.processImagesInMindMap(data, docId);
            
            // 3. 转换为纯净的 Markdown（去除所有 HTML）
            const markdown = this.convertMindMapToCleanMarkdown(data);
            
            // 4. 获取文档的所有直接子块
            const childBlocks = await api.getChildBlocks(docId);
            
            // 5. 删除所有子块
            if (childBlocks && childBlocks.length > 0) {
                for (const block of childBlocks) {
                    await api.deleteBlock(block.id);
                }
            }
            
            // 6. 添加新的 Markdown 内容到文档
            // 需要移除第一行的 H1 标题（因为文档本身就是标题）
            this.debugLog('=== 调试保存过程 ===');
            this.debugLog('原始 Markdown:');
            this.debugLog(markdown);
            this.debugLog('前 20 行:');
            this.debugLog(markdown.split('\n').slice(0, 20).map((line, i) => `${i}: [${line}]`).join('\n'));
            
            const lines = markdown.split('\n');
            let contentLines = lines;
            
            // 如果第一行是 H1 标题，则移除它
            if (lines.length > 0 && lines[0].startsWith('# ')) {
                this.debugLog('移除第一行 H1:', lines[0]);
                contentLines = lines.slice(1);
            }
            
            this.debugLog('移除 H1 后的前 10 行:');
            this.debugLog(contentLines.slice(0, 10).map((line, i) => `${i}: [${line}]`).join('\n'));
            
            // 移除开头的所有空行
            let removedCount = 0;
            while (contentLines.length > 0 && contentLines[0].trim() === '') {
                contentLines.shift();
                removedCount++;
            }
            this.debugLog('移除了', removedCount, '个开头空行');
            
            // 如果第一行是标题且第二行是空行，移除第二行
            // 这样可以避免文档开头出现空行
            if (contentLines.length > 1 && 
                contentLines[0].match(/^#{1,6}\s+/) && 
                contentLines[1].trim() === '') {
                this.debugLog('移除第一个标题后的空行');
                contentLines.splice(1, 1);
            }
            
            // 移除结尾的所有空行
            let removedEndCount = 0;
            while (contentLines.length > 0 && contentLines[contentLines.length - 1].trim() === '') {
                contentLines.pop();
                removedEndCount++;
            }
            this.debugLog('移除了', removedEndCount, '个结尾空行');
            
            let contentMarkdown = contentLines.join('\n');
            
            // 确保 Markdown 不以换行符开头
            contentMarkdown = contentMarkdown.replace(/^\n+/, '');
            
            // 确保 Markdown 不以换行符结尾（彻底清理）
            contentMarkdown = contentMarkdown.replace(/\n+$/, '');
            
            this.debugLog('最终保存的 Markdown 前 10 行:');
            this.debugLog(contentMarkdown.split('\n').slice(0, 10).map((line, i) => `${i}: [${line}]`).join('\n'));
            this.debugLog('最终 Markdown 后 10 行:');
            this.debugLog(contentMarkdown.split('\n').slice(-10).map((line, i) => `${i}: [${line}]`).join('\n'));
            this.debugLog('最终 Markdown 长度:', contentMarkdown.length);
            this.debugLog('最终 Markdown 的前 50 个字符（带转义）:', JSON.stringify(contentMarkdown.substring(0, 50)));
            this.debugLog('最终 Markdown 的后 50 个字符（带转义）:', JSON.stringify(contentMarkdown.substring(contentMarkdown.length - 50)));
            this.debugLog('=== 调试结束 ===');
            
            // 如果有内容，则添加到文档
            // 由于已经删除了所有子块，直接使用 prependBlock
            if (contentMarkdown) {
                await api.prependBlock('markdown', contentMarkdown, docId);
            }
            
            showMessage('保存成功！', 2000, 'info');
            
        } catch (error) {
            this.debugError('保存失败:', error);
            showMessage(`保存失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 处理思维导图中的图片：将base64图片上传到思源assets文件夹
     * @param data 思维导图数据
     * @param docId 文档ID
     */
    async processImagesInMindMap(data: any, docId: string) {
        if (!data) return;
        
        let imageCounter = 0; // 用于确保文件名唯一性
        let processedCount = 0; // 已处理的图片数量
        
        // 递归处理所有节点
        const processNode = async (node: any) => {
            if (!node) return;
            
            const nodeData = node.data || {};
            
            // 检查是否有图片
            if (nodeData.image && typeof nodeData.image === 'string') {
                const imagePath = nodeData.image;
                
                // 如果是base64格式，需要上传
                if (imagePath.startsWith('data:image/')) {
                    try {
                        processedCount++;
                        this.debugLog(`发现base64图片 [${processedCount}]，准备上传到assets`);
                        showMessage(`正在上传图片 ${processedCount}...`, 1000, 'info');
                        
                        // 解析base64数据
                        const matches = imagePath.match(/^data:image\/(\w+);base64,(.+)$/);
                        if (!matches) {
                            this.debugWarn('无法解析base64图片格式');
                            return;
                        }
                        
                        const imageType = matches[1]; // jpg, png, gif等
                        const base64Data = matches[2];
                        
                        // 将base64转换为Blob
                        const byteCharacters = atob(base64Data);
                        const byteNumbers = new Array(byteCharacters.length);
                        for (let i = 0; i < byteCharacters.length; i++) {
                            byteNumbers[i] = byteCharacters.charCodeAt(i);
                        }
                        const byteArray = new Uint8Array(byteNumbers);
                        const blob = new Blob([byteArray], { type: `image/${imageType}` });
                        
                        // 生成唯一的文件名（时间戳 + 计数器）
                        const timestamp = Date.now();
                        const fileName = `mindmap_${timestamp}_${imageCounter++}.${imageType}`;
                        const file = new File([blob], fileName, { type: `image/${imageType}` });
                        
                        // 构建assets目录路径
                        // 根据API文档，assetsDirPath 是相对于 data 文件夹的路径
                        // "assets" 会上传到 workspace/data/assets/
                        // 参考：https://docs.siyuan-note.club/zh-Hans/reference/community/siyuan-sdk/kernel/api/asset.html
                        const assetsDirPath = 'assets';
                        
                        this.debugLog('上传图片到 data/assets/ 文件夹，文件名:', fileName);
                        
                        // 上传到assets文件夹
                        const uploadResult = await api.upload(assetsDirPath, [file]);
                        
                        this.debugLog('上传结果:', uploadResult);
                        
                        if (uploadResult && uploadResult.succMap && uploadResult.succMap[fileName]) {
                            // 获取上传后的路径（API返回的是完整路径）
                            const uploadedPath = uploadResult.succMap[fileName];
                            this.debugLog('图片上传成功，API返回路径:', uploadedPath);
                            
                            // 使用API返回的路径
                            // 通常格式是：assets/xxx.png（相对于notebook）
                            nodeData.image = uploadedPath;
                            this.debugLog('图片路径已更新为:', nodeData.image);
                            showMessage(`图片 ${processedCount} 上传成功`, 1000, 'info');
                        } else {
                            this.debugWarn('图片上传失败，uploadResult:', uploadResult);
                            showMessage(`图片 ${processedCount} 上传失败`, 3000, 'error');
                        }
                        
                    } catch (error) {
                        this.debugError('处理base64图片失败:', error);
                        showMessage(`处理图片 ${processedCount} 失败: ${error.message}`, 3000, 'error');
                    }
                } 
                // 如果已经是assets/xxx格式，不做处理（避免资源冗余）
                else if (imagePath.startsWith('assets/') || imagePath.includes('/assets/')) {
                    this.debugLog('图片已经在assets文件夹，跳过处理避免冗余:', imagePath);
                }
                // 如果是其他格式（如http链接），也不做处理
                else if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                    this.debugLog('图片是外部链接，跳过处理:', imagePath);
                }
                // 其他未知格式
                else {
                    this.debugLog('未知图片格式，跳过处理:', imagePath);
                }
            }
            
            // 递归处理子节点
            if (node.children && Array.isArray(node.children)) {
                for (const child of node.children) {
                    await processNode(child);
                }
            }
        };
        
        await processNode(data);
        
        if (processedCount > 0) {
            this.debugLog(`图片处理完成，共处理 ${processedCount} 张图片`);
            showMessage(`共处理 ${processedCount} 张图片`, 2000, 'info');
        }
    }

    /**
     * 从 HTML 文本中提取纯文本（去除所有标签和样式）
     */
    stripHtmlTags(html: string): string {
        if (!html) return '';
        
        // 创建一个临时 DOM 元素来解析 HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // 获取纯文本内容
        let text = tempDiv.textContent || tempDiv.innerText || '';
        
        // 清理多余的空白字符
        text = text.replace(/\s+/g, ' ').trim();
        
        return text;
    }

    /**
     * 从节点数据中提取纯文本
     */
    getCleanNodeText(nodeData: any): string {
        if (!nodeData || !nodeData.text) return '';
        
        const text = nodeData.text;
        
        // 如果是富文本，需要清理 HTML 标签
        if (nodeData.richText) {
            return this.stripHtmlTags(text);
        }
        
        // 如果是普通文本，直接返回
        return text;
    }

    /**
     * 处理图片路径
     * @param imagePath 原始图片路径
     * @param mode 处理模式：'relative' | 'absolute' | 'copy'
     */
    async processImagePath(imagePath: string, mode: string = 'relative'): Promise<string> {
        if (!imagePath) return imagePath;
        
        switch (mode) {
            case 'absolute':
                // 转换为绝对路径
                if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                    return imagePath;
                }
                // 思源笔记的相对路径，转换为完整的文件系统路径
                if (imagePath.startsWith('/')) {
                    // 获取思源工作空间路径
                    const workspaceDir = window.siyuan.config.system.workspaceDir;
                    // 思源资源路径 /assets/xxx 实际在文件系统中是 workspaceDir/data/assets/xxx
                    let fullPath = imagePath;
                    if (imagePath.startsWith('/assets/')) {
                        fullPath = `/data${imagePath}`;
                    }
                    return `file:///${workspaceDir}${fullPath}`.replace(/\\/g, '/');
                }
                return imagePath;
                
            case 'copy':
                // 复制图片模式，返回相对于导出文件夹的路径
                // 从原路径提取文件名
                const fileName = imagePath.split('/').pop() || 'image.png';
                return `./images/${fileName}`;
                
            case 'relative':
            default:
                // 保持思源相对路径不变
                return imagePath;
        }
    }

    /**
     * 收集所有需要复制的图片路径
     * @param data 思维导图数据
     * @returns 图片路径数组（去重后）
     */
    collectImagePaths(data: any): string[] {
        const imagesSet = new Set<string>();
        
        const traverse = (node: any) => {
            if (!node) return;
            
            const nodeData = node.data || {};
            if (nodeData.image && nodeData.image.trim()) {
                imagesSet.add(nodeData.image);
            }
            
            if (node.children && node.children.length > 0) {
                node.children.forEach((child: any) => traverse(child));
            }
        };
        
        traverse(data);
        return Array.from(imagesSet);
    }

    /**
     * 使用 JSZip 打包导出文件和图片
     * @param content 主文件内容（包含原始图片路径）
     * @param fileName 主文件名（不含扩展名）
     * @param extension 文件扩展名（如 .md, .json, .txt）
     * @param data 思维导图数据（用于提取图片）
     */
    async exportWithImages(content: string, fileName: string, extension: string, data: any) {
        const imagePaths = this.collectImagePaths(data);
        
        if (imagePaths.length === 0) {
            // 没有图片，直接下载文件
            const mimeType = this.getMimeType(extension);
            const blob = new Blob([content], { type: mimeType });
            this.downloadFile(blob, `${fileName}${extension}`);
            showMessage('导出成功', 2000, 'info');
            return;
        }
        
        showMessage(`正在打包 ${imagePaths.length} 张图片...`, 3000, 'info');
        
        // 记录图片路径映射（原始路径 -> 新路径）
        const pathMapping = new Map<string, string>();
        
        try {
            const zip = new JSZip();
            
            // 创建 images 文件夹
            const imagesFolder = zip.folder('images');
            
            // 下载并添加所有图片
            let successCount = 0;
            let failedCount = 0;
            
            for (let i = 0; i < imagePaths.length; i++) {
                const imagePath = imagePaths[i];
                
                try {
                    this.debugLog(`\n=== 处理图片 ${i + 1}/${imagePaths.length} ===`);
                    this.debugLog('原始路径:', imagePath);
                    
                    // 获取文件名
                    const imageFileName = imagePath.split('/').pop() || `image_${i}.png`;
                    this.debugLog('文件名:', imageFileName);
                    
                    let blob: Blob;
                    
                    // 判断是否是外部 URL
                    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                        // 外部 URL，直接 fetch
                        this.debugLog('-> 外部 URL，直接 fetch');
                        const response = await fetch(imagePath);
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        blob = await response.blob();
                        this.debugLog('✓ fetch 成功:', blob.size, 'bytes, type:', blob.type);
                    } else {
                        // 思源内部资源，使用 API 获取
                        // 思源资源路径 /assets/xxx 在文件系统中是 data/assets/xxx
                        let apiPath = imagePath;
                        if (apiPath.startsWith('/assets/')) {
                            // 去掉开头的 /，加上 data 目录
                            apiPath = 'data' + apiPath;
                        } else if (apiPath.startsWith('/')) {
                            // 其他以 / 开头的路径，去掉 /
                            apiPath = apiPath.substring(1);
                        }
                        
                        this.debugLog('-> 思源内部资源');
                        this.debugLog('   API 路径:', apiPath);
                        
                        // 使用思源 API 获取文件
                        const result = await api.getFileBlob(apiPath);
                        if (!result) {
                            throw new Error('API 返回 null');
                        }
                        blob = result;
                        this.debugLog('✓ API 获取成功:', blob.size, 'bytes, type:', blob.type);
                        
                        // 验证 blob 是否有效
                        if (blob.size < 100) {
                            this.debugWarn('⚠️ 警告：图片文件太小，可能不是有效的图片');
                        }
                        
                        // 检查 MIME 类型
                        if (!blob.type.startsWith('image/')) {
                            this.debugWarn('⚠️ 警告：MIME 类型不是图片:', blob.type);
                            // 尝试读取一部分内容看看是不是 JSON 错误
                            const text = await blob.slice(0, 200).text();
                            this.debugLog('   前 200 字节内容:', text);
                        }
                    }
                    
                    // 添加到 ZIP
                    imagesFolder.file(imageFileName, blob);
                    successCount++;
                    this.debugLog('✓ 已添加到 ZIP');
                    
                    // 记录路径映射：原始路径 -> 新路径
                    pathMapping.set(imagePath, `./images/${imageFileName}`);
                    
                    // 显示进度
                    if ((i + 1) % 5 === 0 || i === imagePaths.length - 1) {
                        showMessage(`已处理 ${i + 1}/${imagePaths.length} 张图片...`, 1000, 'info');
                    }
                } catch (error) {
                    this.debugError('✗ 处理图片失败:', imagePath);
                    this.debugError('   错误:', error);
                    failedCount++;
                }
            }
            
            // 替换内容中的图片路径
            let finalContent = content;
            for (const [oldPath, newPath] of pathMapping) {
                // 使用全局替换，处理可能出现多次的情况
                finalContent = finalContent.replace(new RegExp(oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newPath);
            }
            
            // 添加主文件（使用替换后的内容）
            zip.file(`${fileName}${extension}`, finalContent);
            
            // 生成 ZIP 文件
            showMessage('正在生成压缩包...', 2000, 'info');
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            
            // 下载 ZIP 文件
            this.downloadFile(zipBlob, `${fileName}.zip`);
            
            // 显示结果
            if (failedCount > 0) {
                showMessage(`导出完成：成功 ${successCount} 张，失败 ${failedCount} 张`, 4000, 'error');
            } else {
                showMessage(`导出成功：已打包 ${successCount} 张图片`, 3000, 'info');
            }
        } catch (error) {
            this.debugError('打包失败:', error);
            showMessage(`打包失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 根据扩展名获取 MIME 类型
     * @param extension 文件扩展名
     */
    getMimeType(extension: string): string {
        const mimeTypes: { [key: string]: string } = {
            '.json': 'application/json',
            '.md': 'text/markdown',
            '.txt': 'text/plain',
            '.html': 'text/html',
            '.xml': 'application/xml'
        };
        return mimeTypes[extension] || 'text/plain';
    }

    /**
     * 深度克隆并处理节点数据（去除样式或处理图片）
     * @param data 原始数据
     * @param removeStyle 是否去除样式
     * @param imageSaveMode 图片保存模式
     */
    async processNodeData(data: any, removeStyle: boolean = false, imageSaveMode: string = 'relative'): Promise<any> {
        if (!data) return data;
        
        // 深度克隆对象
        const cloned = JSON.parse(JSON.stringify(data));
        
        const traverse = async (node: any) => {
            if (!node) return;
            
            const nodeData = node.data || {};
            
            // 处理文本：去除样式
            if (removeStyle && nodeData.text) {
                // 如果是富文本，去除 HTML 标签和样式
                if (nodeData.richText) {
                    nodeData.text = this.stripHtmlTags(nodeData.text);
                    nodeData.richText = false; // 标记为非富文本
                }
            }
            
            // 处理图片路径
            if (nodeData.image) {
                nodeData.image = await this.processImagePath(nodeData.image, imageSaveMode);
            }
            
            // 处理备注：去除样式
            if (removeStyle && nodeData.note) {
                nodeData.note = this.stripHtmlTags(nodeData.note);
            }
            
            // 递归处理子节点
            if (node.children && node.children.length > 0) {
                for (const child of node.children) {
                    await traverse(child);
                }
            }
        };
        
        await traverse(cloned);
        return cloned;
    }

    /**
     * 将思维导图数据转换为纯净的 Markdown（完全去除 HTML）
     */
    convertMindMapToCleanMarkdown(data: any): string {
        const lines: string[] = [];
        
        // 获取用户设置的标题级数（默认为 6）
        const maxHeadingLevel = this.settingUtils.get(headingLevelsName) || 6;
        
        // 递归遍历节点树
        const traverse = (node: any, level: number = 0, isLastSibling: boolean = false) => {
            if (!node) return;
            
            const nodeData = node.data || {};
            
            // 提取纯文本（去除所有 HTML 标签）
            let text = this.getCleanNodeText(nodeData);
            
            // 如果节点有图片，添加图片 Markdown 语法
            if (nodeData.image) {
                const imageMarkdown = `![图片](${nodeData.image})`;
                if (text) {
                    text = `${text}\n\n${imageMarkdown}`;
                } else {
                    text = imageMarkdown;
                }
            }
            
            // 根据层级和用户设置的最大标题级数生成标题或列表
            if (level === 0) {
                // 根节点作为 H1（不添加空行，因为会被移除）
                lines.push(`# ${text}`);
            } else if (level < maxHeadingLevel) {
                // 在用户设置的标题级数范围内，使用标题
                // level 0 是 H1（第1级），level 1 是 H2（第2级），以此类推
                // 所以当 maxHeadingLevel = 4 时，level 0,1,2,3 是标题（H1-H4），level 4 开始是列表
                const titleMark = '#'.repeat(level + 1);
                lines.push(`${titleMark} ${text}`);
                // 只在有子节点时才添加空行
                if (node.children && node.children.length > 0) {
                    lines.push(''); // 空行
                }
            } else {
                // 超过用户设置的标题级数，使用无序列表
                // 计算缩进级别：第 maxHeadingLevel 级为无缩进列表，之后每级增加一级缩进
                const indent = '  '.repeat(level - maxHeadingLevel);
                lines.push(`${indent}* ${text}`);
            }
            
            // 如果有备注，添加备注
            if (nodeData.note) {
                const cleanNote = this.stripHtmlTags(nodeData.note);
                if (cleanNote) {
                    lines.push(cleanNote);
                    lines.push(''); // 空行
                }
            }
            
            // 递归处理子节点
            if (node.children && node.children.length > 0) {
                node.children.forEach((child: any, index: number) => {
                    const isLast = index === node.children.length - 1;
                    traverse(child, level + 1, isLast);
                });
            }
        };
        
        traverse(data);
        
        // 移除末尾的所有空行
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
            lines.pop();
        }
        
        return lines.join('\n');
    }

    /**
     * 将思维导图数据转换为 Markdown（使用 simple-mind-map 内置方法）
     * @deprecated 此方法会保留 HTML 标签，请使用 convertMindMapToCleanMarkdown
     */
    convertMindMapToMarkdown(data: any): string {
        return transformToMarkdown(data);
    }

    /**
     * 显示插入思维导图块的对话框
     */
    async showInsertMindMapDialog() {
        try {
            // 获取当前激活的编辑器
            const protyle = getProtyle();
            if (!protyle) {
                showMessage('请先打开一个文档', 3000, 'error');
                return;
            }

            // 构建文档树
            const docTree = await this.buildDocTreeMindMap();

            // 创建对话框
            const dialog = new Dialog({
                title: "选择要嵌入的文档",
                content: `
                    <div class="b3-dialog__content" style="padding: 16px;">
                        <div style="margin-bottom: 12px;">
                            <input id="docSearchInput" class="b3-text-field" placeholder="搜索文档..." style="width: 100%;">
                        </div>
                        <div id="docListContainer" style="max-height: 400px; overflow-y: auto; border: 1px solid var(--b3-border-color); border-radius: 4px; padding: 8px;">
                            <div id="docList"></div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel">取消</button>
                        <button id="confirmInsert" class="b3-button b3-button--text" disabled>插入</button>
                    </div>
                `,
                width: "600px",
                height: "500px"
            });

            // 渲染文档列表
            let selectedDocId = '';
            let selectedDocTitle = '';
            const renderDocList = (searchText = '') => {
                const docListElement = dialog.element.querySelector('#docList');
                if (!docListElement) return;

                docListElement.innerHTML = '';

                const traverse = (node: MindMapNode, level: number = 0) => {
                    const data = node.data;
                    
                    // 跳过工作空间和笔记本节点
                    if (data.isWorkspace || data.isNotebook) {
                        if (node.children) {
                            node.children.forEach(child => traverse(child, level));
                        }
                        return;
                    }

                    // 搜索过滤
                    if (searchText && !data.text.toLowerCase().includes(searchText.toLowerCase())) {
                        // 检查子节点是否匹配
                        let hasMatchingChild = false;
                        if (node.children) {
                            const checkChildren = (n: MindMapNode): boolean => {
                                if (n.data.text.toLowerCase().includes(searchText.toLowerCase())) {
                                    return true;
                                }
                                if (n.children) {
                                    return n.children.some(c => checkChildren(c));
                                }
                                return false;
                            };
                            hasMatchingChild = node.children.some(c => checkChildren(c));
                        }
                        if (!hasMatchingChild) {
                            return;
                        }
                    }

                    // 创建文档项
                    const docItem = document.createElement('div');
                    docItem.className = 'mindmap-doc-item';
                    docItem.style.cssText = `
                        padding: 6px 12px;
                        margin: 2px 0;
                        cursor: pointer;
                        border-radius: 4px;
                        padding-left: ${level * 20 + 12}px;
                        transition: background-color 0.2s;
                    `;
                    docItem.innerHTML = `<span style="color: var(--b3-theme-on-background);">${data.text}</span>`;

                    // 点击选择
                    docItem.addEventListener('click', () => {
                        dialog.element.querySelectorAll('.mindmap-doc-item').forEach(el => {
                            (el as HTMLElement).style.backgroundColor = '';
                        });
                        docItem.style.backgroundColor = 'var(--b3-list-hover)';
                        selectedDocId = data.id || '';
                        selectedDocTitle = data.text;
                        
                        const confirmBtn = dialog.element.querySelector('#confirmInsert') as HTMLButtonElement;
                        if (confirmBtn) {
                            confirmBtn.disabled = !selectedDocId;
                        }
                    });

                    // 悬停效果
                    docItem.addEventListener('mouseenter', () => {
                        if (docItem.style.backgroundColor !== 'var(--b3-list-hover)') {
                            docItem.style.backgroundColor = 'var(--b3-theme-surface-lighter)';
                        }
                    });
                    docItem.addEventListener('mouseleave', () => {
                        if (selectedDocId !== data.id) {
                            docItem.style.backgroundColor = '';
                        }
                    });

                    docListElement.appendChild(docItem);

                    // 递归处理子节点
                    if (node.children) {
                        node.children.forEach(child => traverse(child, level + 1));
                    }
                };

                traverse(docTree);
            };

            renderDocList();

            // 搜索框事件
            const searchInput = dialog.element.querySelector('#docSearchInput') as HTMLInputElement;
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    renderDocList((e.target as HTMLInputElement).value);
                });
            }

            // 取消按钮
            const cancelBtn = dialog.element.querySelector('.b3-button--cancel');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => dialog.destroy());
            }

            // 确认插入按钮
            const confirmBtn = dialog.element.querySelector('#confirmInsert');
            if (confirmBtn) {
                confirmBtn.addEventListener('click', async () => {
                    if (!selectedDocId) {
                        showMessage('请选择一个文档', 2000, 'error');
                        return;
                    }
                    dialog.destroy();
                    await this.insertMindMapBlock(selectedDocId, selectedDocTitle);
                });
            }

        } catch (error) {
            this.debugError('显示文档选择对话框失败:', error);
            showMessage(`显示对话框失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 插入思维导图块到当前文档
     */
    async insertMindMapBlock(docId: string, docTitle: string) {
        try {
            showMessage('正在插入思维导图块...', 2000, 'info');

            // 获取当前激活的编辑器（确保插入到光标所在的文档）
            const protyle = getProtyle();
            if (!protyle) {
                showMessage('无法获取当前编辑器，请确保光标在文档中', 3000, 'error');
                return;
            }

            const currentDocId = protyle.block.rootID;
            this.debugLog('当前文档ID:', currentDocId);

            // 获取光标所在的块ID
            let cursorBlockId: string | null = null;
            
            // 方法1: 尝试从选区获取
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                let node = range.startContainer;
                
                // 向上查找，找到包含 data-node-id 的块元素
                while (node && node !== document.body) {
                    if (node instanceof HTMLElement) {
                        const nodeId = node.getAttribute('data-node-id');
                        if (nodeId) {
                            cursorBlockId = nodeId;
                            this.debugLog('从选区找到光标块ID:', cursorBlockId);
                            break;
                        }
                    }
                    node = node.parentNode as Node;
                }
            }
            
            // 方法2: 如果方法1失败，尝试从 protyle 获取
            if (!cursorBlockId && protyle.toolbar?.range) {
                const range = protyle.toolbar.range;
                let node = range.startContainer;
                while (node && node !== document.body) {
                    if (node instanceof HTMLElement) {
                        const nodeId = node.getAttribute('data-node-id');
                        if (nodeId) {
                            cursorBlockId = nodeId;
                            this.debugLog('从 protyle 找到光标块ID:', cursorBlockId);
                            break;
                        }
                    }
                    node = node.parentNode as Node;
                }
            }

            // 使用自定义属性标记块
            // 思源支持 {: custom-attr="value"} 语法来添加自定义属性
            const uniqueId = `mindmap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const markdownContent = `🗺️ **嵌入式思维导图**: ${docTitle}  \n*正在加载...*\n{: custom-mindmap-id="${uniqueId}" custom-doc-id="${docId}" custom-doc-title="${encodeURIComponent(docTitle)}" style="border: 2px dashed var(--b3-border-color); border-radius: 8px; padding: 16px; text-align: center;"}`;

            // 如果找到光标所在块，则在该块之后插入；否则追加到文档末尾
            let result;
            if (cursorBlockId) {
                this.debugLog('在光标块后插入，块ID:', cursorBlockId);
                result = await api.insertBlock('markdown', markdownContent, undefined, cursorBlockId, currentDocId);
            } else {
                this.debugLog('未找到光标块，追加到文档末尾');
                result = await api.appendBlock('markdown', markdownContent, currentDocId);
            }
            
            this.debugLog('插入块结果:', result);
            
            // 获取思源自动生成的块 ID
            if (result && result[0] && result[0].doOperations && result[0].doOperations[0]) {
                const blockId = result[0].doOperations[0].id;
                this.debugLog('获取到块 ID:', blockId);
                
                // 延迟初始化，多次尝试直到找到元素
                let attempts = 0;
                const maxAttempts = 10;
                const tryInit = () => {
                    attempts++;
                    const blockElement = document.querySelector(`[data-node-id="${blockId}"]`);
                    
                    if (blockElement) {
                        this.debugLog('找到块元素，开始初始化 (尝试次数:', attempts, ')');
                        this.initEmbeddedMindMap(blockId, docId, docTitle);
                    } else if (attempts < maxAttempts) {
                        this.debugLog('第', attempts, '次未找到块元素，500ms 后重试...');
                        setTimeout(tryInit, 500);
                    } else {
                        this.debugError('尝试', maxAttempts, '次后仍未找到块元素:', blockId);
                        this.debugLog('当前所有 HTML 块:', document.querySelectorAll('[data-type="NodeHTMLBlock"]'));
                    }
                };
                
                // 延迟 500ms 后开始第一次尝试
                setTimeout(tryInit, 500);
            } else {
                this.debugError('无法从结果中获取块 ID:', result);
            }

            showMessage('思维导图块已插入', 2000, 'info');

        } catch (error) {
            this.debugError('插入思维导图块失败:', error);
            showMessage(`插入失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 初始化单个嵌入的思维导图
     */
    async initEmbeddedMindMap(blockId: string, docId: string, docTitle: string) {
        try {
            // 防止重复初始化
            if (this.embeddedMindMaps.has(blockId)) {
                this.debugLog('思维导图已初始化，跳过:', blockId);
                return;
            }
            
            this.debugLog('initEmbeddedMindMap 被调用:', { blockId, docId, docTitle });
            
            // 使用 data-node-id 属性查找块元素
            const blockElement = document.querySelector(`[data-node-id="${blockId}"]`) as HTMLElement;
            
            if (!blockElement) {
                this.debugError('找不到块元素，blockId:', blockId);
                return;
            }

            // 检查是否已经有 mindmap-embed-wrapper（避免重复创建）
            let wrapperDiv = blockElement.querySelector('.mindmap-embed-wrapper') as HTMLElement;
            
            if (wrapperDiv) {
                this.debugLog('思维导图已渲染，跳过');
                return;
            }

            // 隐藏所有原始子元素（段落内容、protyle-attr等）
            const children = Array.from(blockElement.children);
            children.forEach((child: Element) => {
                const htmlChild = child as HTMLElement;
                if (!htmlChild.classList.contains('mindmap-embed-wrapper')) {
                    htmlChild.style.display = 'none';
                }
            });

            // 创建思维导图容器
            if (!wrapperDiv) {
                wrapperDiv = document.createElement('div');
                wrapperDiv.className = 'mindmap-embed-wrapper';
                wrapperDiv.setAttribute('data-type', 'mindmap-embed');
                wrapperDiv.setAttribute('data-doc-id', docId);
                wrapperDiv.setAttribute('data-doc-title', docTitle);
                wrapperDiv.style.cssText = `
                    border: 2px solid var(--b3-border-color);
                    border-radius: 8px;
                    padding: 16px;
                    margin: 16px 0;
                    background: var(--b3-theme-surface);
                    display: block;
                    width: calc(100% - 32px);
                `;
                
                // 创建头部
                const headerDiv = document.createElement('div');
                headerDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;';
                
                const titleDiv = document.createElement('div');
                titleDiv.style.cssText = 'display: flex; align-items: center;';
                titleDiv.innerHTML = `
                    <svg style="width: 20px; height: 20px; margin-right: 8px; color: var(--b3-theme-primary);"><use xlink:href="#iconMindmap"></use></svg>
                    <span style="font-size: 14px; font-weight: 500; color: var(--b3-theme-on-background);">${docTitle}</span>
                `;
                
                const expandBtn = document.createElement('button');
                expandBtn.className = 'b3-button b3-button--outline expand-mindmap-btn';
                expandBtn.style.cssText = 'padding: 4px 12px; font-size: 12px;';
                expandBtn.innerHTML = `
                    <svg style="width: 12px; height: 12px;"><use xlink:href="#iconFullscreen"></use></svg>
                    <span style="margin-left: 4px;">展开</span>
                `;
                expandBtn.onclick = () => this.openDocMindMapDialogForDoc(docId, docTitle);
                
                headerDiv.appendChild(titleDiv);
                headerDiv.appendChild(expandBtn);
                
                // 创建思维导图容器
                const mindmapContainer = document.createElement('div');
                mindmapContainer.className = 'mindmap-container';
                
                // 尝试从块属性恢复高度，否则使用默认值
                const savedHeight = blockElement.getAttribute('custom-mindmap-height');
                const containerHeight = savedHeight ? parseInt(savedHeight) : 400;
                
                mindmapContainer.style.cssText = `
                    background: var(--b3-theme-background);
                    border-radius: 4px;
                    height: ${containerHeight}px;
                    width: 100%;
                    overflow: hidden;
                    position: relative;
                    display: block;
                `;
                
                // 创建拖动句柄容器（放在思维导图外面）
                const resizeHandleContainer = document.createElement('div');
                resizeHandleContainer.style.cssText = `
                    position: relative;
                    width: 100%;
                    height: 0;
                    pointer-events: none;
                `;
                
                // 创建拖动句柄
                const resizeHandle = document.createElement('div');
                resizeHandle.className = 'mindmap-resize-handle';
                resizeHandle.style.cssText = `
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 12px;
                    background: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.05) 100%);
                    cursor: ns-resize;
                    z-index: 1000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    pointer-events: auto;
                    transform: translateY(-12px);
                `;
                
                // 添加可视化指示器
                const handleIndicator = document.createElement('div');
                handleIndicator.style.cssText = `
                    width: 50px;
                    height: 4px;
                    background: var(--b3-border-color);
                    border-radius: 2px;
                    opacity: 0.6;
                    transition: all 0.2s ease;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                `;
                
                resizeHandle.appendChild(handleIndicator);
                
                // 鼠标悬停效果
                resizeHandle.addEventListener('mouseenter', () => {
                    handleIndicator.style.opacity = '1';
                    handleIndicator.style.background = 'var(--b3-theme-primary)';
                    handleIndicator.style.width = '70px';
                    handleIndicator.style.height = '5px';
                    resizeHandle.style.background = 'linear-gradient(to bottom, transparent 0%, rgba(59, 130, 246, 0.1) 100%)';
                });
                
                resizeHandle.addEventListener('mouseleave', () => {
                    handleIndicator.style.opacity = '0.6';
                    handleIndicator.style.background = 'var(--b3-border-color)';
                    handleIndicator.style.width = '50px';
                    handleIndicator.style.height = '4px';
                    resizeHandle.style.background = 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.05) 100%)';
                });
                
                // 绑定拖动事件
                this.bindResizeHandle(resizeHandle, mindmapContainer, blockElement);
                
                resizeHandleContainer.appendChild(resizeHandle);
                
                wrapperDiv.appendChild(headerDiv);
                wrapperDiv.appendChild(mindmapContainer);
                wrapperDiv.appendChild(resizeHandleContainer);
                
                // 将整个容器插入到 blockElement 中
                blockElement.appendChild(wrapperDiv);
            }

            // 获取思维导图容器
            const container = wrapperDiv.querySelector('.mindmap-container') as HTMLElement;
            
            if (!container) {
                this.debugError('找不到思维导图容器');
                return;
            }

            // 等待一小段时间让 DOM 完全渲染
            await new Promise(resolve => setTimeout(resolve, 100));

            this.debugLog('开始获取思维导图数据...');
            // 获取思维导图数据
            const mindMapData = await parseDocumentBlocksToMindMap(docId, docTitle);
            this.debugLog('思维导图数据获取成功');

            // 移除加载提示
            const loadingElement = container.querySelector('.mindmap-loading');
            if (loadingElement) {
                loadingElement.remove();
            }

            container.innerHTML = '';

            this.debugLog('创建思维导图实例...');
            
            // 获取展开层级配置（行内思维导图使用文档思维导图的配置）
            const expandLevel = this.settingUtils.get(docMindMapExpandLevelName) ?? 3;
            this.debugLog('行内思维导图展开层级:', expandLevel);
            
            // 创建思维导图实例（只读模式）
            const mindMap = new MindMap({
                el: container,
                data: mindMapData,
                layout: 'logicalStructure',
                readonly: true,
                themeConfig: {
                    backgroundColor: document.documentElement.getAttribute('data-theme-mode') === 'dark' ? '#1e1e1e' : '#fff',
                    fontSize: 12,
                    paddingX: 15,
                    paddingY: 10,
                },
                enableFreeDrag: false,
                enableCtrlKeyNodeSelection: false,
            } as any);
            
            // 应用展开层级
            setTimeout(() => {
                if (expandLevel === -1) {
                    // 全部展开
                    mindMap.execCommand('EXPAND_ALL');
                } else if (expandLevel >= 0) {
                    // 展开到指定层级
                    this.expandToLevel(mindMap, expandLevel);
                }
            }, 200);

            this.debugLog('思维导图实例创建成功');
            this.embeddedMindMaps.set(blockId, mindMap);

            this.debugLog('嵌入的思维导图初始化完成');

        } catch (error) {
            this.debugError('初始化嵌入思维导图失败:', error, blockId);
            
            // 在容器中显示错误信息
            const blockElement = document.querySelector(`[data-node-id="${blockId}"]`);
            if (blockElement) {
                const container = blockElement.querySelector('.mindmap-container') as HTMLElement;
                if (container) {
                    container.innerHTML = `
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 20px; text-align: center;">
                            <svg style="width: 48px; height: 48px; color: var(--b3-theme-error); margin-bottom: 12px;"><use xlink:href="#iconClose"></use></svg>
                            <div style="font-size: 14px; font-weight: 500; color: var(--b3-theme-error); margin-bottom: 8px;">思维导图加载失败</div>
                            <div style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.7;">${error.message || '未知错误'}</div>
                            <button class="b3-button b3-button--outline" style="margin-top: 16px;" onclick="location.reload()">刷新页面重试</button>
                        </div>
                    `;
                }
            }
        }
    }

    /**
     * ==================================================================================
     * 【核心函数】从块元素中提取信息并加载思维导图
     * ==================================================================================
     * 
     * 功能说明：
     * 这是一个通用的加载函数，被多个场景调用，统一处理嵌入式思维导图的加载逻辑
     * 
     * 调用场景：
     * - 场景1：插件初始化时批量加载已存在的思维导图块（initAllEmbeddedMindMaps）
     * - 场景2：用户插入新的思维导图块时（observeDocumentChanges）
     * - 场景3：文档刷新或切换后重新加载（reloadVisibleMindMaps）
     * 
     * @param blockElement 思维导图块的 DOM 元素
     * @param forceReload 是否强制重新加载（true 时会清除并重建，false 时跳过已加载的）
     * 
     * ==================================================================================
     */
    private loadMindMapFromElement(blockElement: Element, forceReload: boolean = false) {
        // ============================================================
        // 1. 数据验证阶段
        // ============================================================
        
        // 1.1 提取块 ID
        const blockId = blockElement.getAttribute('data-node-id');
        if (!blockId) return; // 无效块，直接返回
        
        // 1.2 检查是否需要跳过加载（非强制重载模式下）
        if (!forceReload) {
            // 1.2.1 如果内存中已有实例，跳过
            if (this.embeddedMindMaps.has(blockId)) return;
            
            // 1.2.2 如果 DOM 中已有渲染容器，跳过
            if (blockElement.querySelector('.mindmap-embed-wrapper')) return;
        }
        
        // ============================================================
        // 2. 数据提取阶段
        // ============================================================
        
        // 2.1 从自定义属性提取思维导图关联的文档信息
        const docId = blockElement.getAttribute('custom-doc-id');
        const encodedTitle = blockElement.getAttribute('custom-doc-title');
        
        // 2.2 验证必需数据是否完整
        if (!docId || !encodedTitle) return;
        
        // 2.3 解码文档标题
        const docTitle = decodeURIComponent(encodedTitle);
        this.debugLog('发现嵌入思维导图块:', { blockId, docId, docTitle, forceReload });
        
        // ============================================================
        // 3. 强制重载时的清理阶段
        // ============================================================
        
        if (forceReload && this.embeddedMindMaps.has(blockId)) {
            // 3.1 销毁旧的思维导图实例
            const oldMindMap = this.embeddedMindMaps.get(blockId);
            if (oldMindMap && typeof oldMindMap.destroy === 'function') {
                oldMindMap.destroy(); // 调用 simple-mind-map 的销毁方法
            }
            
            // 3.2 从内存映射中删除实例引用
            this.embeddedMindMaps.delete(blockId);
            
            // 3.3 清除 DOM 中的旧渲染容器
            const oldWrapper = blockElement.querySelector('.mindmap-embed-wrapper');
            if (oldWrapper) {
                oldWrapper.remove();
            }
            
            this.debugLog('强制重载，已清理旧实例:', blockId);
        }
        
        // ============================================================
        // 4. 初始化加载阶段
        // ============================================================
        
        // 4.1 调用核心初始化函数，创建新的思维导图实例
        this.initEmbeddedMindMap(blockId, docId, docTitle);
    }

    /**
     * ==================================================================================
     * 【场景1】初始化所有已存在的嵌入式思维导图
     * ==================================================================================
     * 
     * 功能说明：
     * 在插件加载完成后（onLayoutReady），批量检测并初始化页面中已存在的思维导图块
     * 
     * 调用时机：
     * - 插件启动后延迟 2000ms 执行（确保思源完全加载）
     * 
     * 特点：
     * - 批量处理，提高效率
     * - 使用非强制加载模式（forceReload = false）
     * - 自动跳过已初始化的块
     * 
     * ==================================================================================
     */
    initAllEmbeddedMindMaps() {
        // ============================================================
        // 1. DOM 查询阶段
        // ============================================================
        
        // 1.1 查找所有带有 custom-mindmap-id 属性的块
        // 这个属性是思维导图块的唯一标识
        const blocks = document.querySelectorAll('[custom-mindmap-id]');
        
        // 1.2 输出检测结果
        this.debugLog('批量检测：找到', blocks.length, '个嵌入思维导图块');
        
        // ============================================================
        // 2. 批量初始化阶段
        // ============================================================
        
        // 2.1 遍历所有找到的思维导图块
        blocks.forEach((blockElement) => {
            // 2.1.1 调用通用加载函数
            // 参数说明：
            //   - blockElement: 当前块元素
            //   - false: 非强制重载，会跳过已加载的块
            this.loadMindMapFromElement(blockElement, false);
        });
    }

    /**
     * ==================================================================================
     * 【场景3】检测并重新加载当前可见文档中的思维导图块
     * ==================================================================================
     * 
     * 功能说明：
     * 当文档切换或刷新后，检测页面中未正确渲染的思维导图块并强制重新加载
     * 
     * 调用时机：
     * - 思源刷新按钮点击后（loaded-protyle-static 事件）
     * - 文档动态加载完成后（loaded-protyle-dynamic 事件）
     * - DOM 大范围变化时（MutationObserver 兜底）
     * 
     * 核心逻辑：
     * - 检测 DOM 中是否存在渲染容器（.mindmap-embed-wrapper）
     * - 如果容器不存在，说明需要重新加载
     * - 使用强制重载模式，确保清理旧实例
     * 
     * ==================================================================================
     */
    private reloadVisibleMindMaps() {
        // ============================================================
        // 1. 初始化检测阶段
        // ============================================================
        
        this.debugLog('重新检测当前文档中的思维导图块...');
        
        // 1.1 查找所有思维导图块
        const blocks = document.querySelectorAll('[custom-mindmap-id]');
        this.debugLog('当前文档：找到', blocks.length, '个嵌入思维导图块');
        
        // 1.2 如果没有找到任何块，直接返回
        if (blocks.length === 0) return;
        
        // ============================================================
        // 2. 遍历检测与重载阶段
        // ============================================================
        
        let reloadCount = 0; // 统计需要重载的块数量
        
        blocks.forEach((blockElement) => {
            // 2.1 提取块 ID
            const blockId = blockElement.getAttribute('data-node-id');
            if (!blockId) return; // 无效块，跳过
            
            // 2.2 检查是否已经渲染
            // 通过查找 .mindmap-embed-wrapper 容器判断
            const hasWrapper = blockElement.querySelector('.mindmap-embed-wrapper');
            
            // 2.3 决策是否需要重新加载
            // 判断条件：
            //   - 没有 wrapper：说明未渲染或渲染失败
            //   - 需要强制重载：清除旧实例并重新创建
            if (!hasWrapper) {
                // 2.3.1 调用通用加载函数，使用强制重载模式
                // 参数说明：
                //   - blockElement: 当前块元素
                //   - true: 强制重载，会清理旧实例
                this.loadMindMapFromElement(blockElement, true);
                reloadCount++;
            }
        });
        
        // ============================================================
        // 3. 结果反馈阶段
        // ============================================================
        
        // 3.1 输出重载统计信息
        if (reloadCount > 0) {
            this.debugLog(`已触发 ${reloadCount} 个思维导图块的重新加载`);
        }
    }

    /**
     * ==================================================================================
     * 【场景2】监听文档变化，自动初始化新插入的思维导图块
     * ==================================================================================
     * 
     * 功能说明：
     * 使用 MutationObserver 实时监听 DOM 变化，当用户插入新的思维导图块时自动初始化
     * 
     * 监听内容：
     * - 属性变化：custom-mindmap-id 属性的添加或修改
     * - 节点添加：新的带有 custom-mindmap-id 的元素被插入 DOM
     * 
     * 调用时机：
     * - 插件启动时（onLayoutReady）创建监听器
     * - 持续运行，直到插件卸载
     * 
     * 特点：
     * - 实时响应，延迟 1000ms 执行（确保 DOM 稳定）
     * - 递归检测子元素
     * - 使用非强制加载模式
     * 
     * ==================================================================================
     */
    observeDocumentChanges() {
        // ============================================================
        // 1. 初始化监听器
        // ============================================================
        
        // 1.1 清理旧的监听器（如果存在）
        if (this.documentObserver) {
            this.documentObserver.disconnect();
        }

        // 1.2 创建新的 MutationObserver 实例
        this.documentObserver = new MutationObserver((mutations) => {
            // ============================================================
            // 2. 处理 DOM 变化
            // ============================================================
            
            mutations.forEach((mutation) => {
                // --------------------------------------------------------
                // 2.1 监听属性变化
                // --------------------------------------------------------
                // 场景：用户通过编辑器修改块属性，添加 custom-mindmap-id
                if (mutation.type === 'attributes' && mutation.attributeName === 'custom-mindmap-id') {
                    const element = mutation.target as HTMLElement;
                    this.debugLog('检测到属性变化的思维导图块');
                    
                    // 2.1.1 延迟执行，确保属性已完全更新
                    setTimeout(() => {
                        this.loadMindMapFromElement(element, false);
                    }, 1000);
                }
                
                // --------------------------------------------------------
                // 2.2 监听新增节点
                // --------------------------------------------------------
                // 场景：用户插入新的思维导图块，或者粘贴包含思维导图块的内容
                mutation.addedNodes.forEach((node) => {
                    // 2.2.1 验证节点类型（只处理元素节点）
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const element = node as Element;
                        
                        // 2.2.2 检查元素本身是否是思维导图块
                        if (element.hasAttribute?.('custom-mindmap-id')) {
                            this.debugLog('检测到新增的思维导图块（元素本身）');
                            setTimeout(() => {
                                this.loadMindMapFromElement(element, false);
                            }, 1000);
                        }
                        
                        // 2.2.3 检查子元素中是否包含思维导图块
                        // 场景：粘贴包含多个块的内容
                        const blocks = element.querySelectorAll?.('[custom-mindmap-id]');
                        blocks?.forEach((block) => {
                            this.debugLog('检测到新增的思维导图块（子元素）');
                            setTimeout(() => {
                                this.loadMindMapFromElement(block, false);
                            }, 1000);
                        });
                    }
                });
            });
        });

        // ============================================================
        // 3. 启动监听
        // ============================================================
        
        // 3.1 配置监听选项并开始监听
        this.documentObserver.observe(document.body, {
            childList: true,              // 监听子节点的添加和删除
            subtree: true,                 // 监听所有后代节点
            attributes: true,              // 监听属性变化
            attributeFilter: ['custom-mindmap-id']  // 只监听特定属性
        });
    }

    /**
     * ==================================================================================
     * 【监听机制】监听文档切换和刷新事件
     * ==================================================================================
     * 
     * 功能说明：
     * 监听思源笔记的文档刷新和切换事件，确保嵌入式思维导图在这些场景下能够正确重新加载
     * 
     * 监听策略：
     * - 策略1：监听思源官方 EventBus 事件（主要检测方式）
     * - 策略2：使用 MutationObserver 监听 DOM 变化（兜底方案）
     * 
     * 解决的问题：
     * - 问题1：点击思源刷新按钮后，嵌入思维导图不显示
     * - 问题2：切换文档后，新文档中的思维导图不加载
     * - 问题3：浏览器刷新后，思维导图需要手动重新加载
     * 
     * 调用时机：
     * - 插件启动时（onLayoutReady）创建监听器
     * 
     * ==================================================================================
     */
    observeDocumentSwitch() {
        this.debugLog('开始监听文档切换和刷新事件...');
        
        // ============================================================
        // 1. 初始化节流机制
        // ============================================================
        
        let reloadTimer: number | null = null;
        
        /**
         * 节流触发重载的通用函数
         * 
         * 目的：
         * - 避免短时间内多个事件同时触发导致重复加载
         * - 合并多个连续触发为一次执行
         * 
         * 节流时间：500ms
         * 
         * @param reason 触发原因（用于调试日志）
         */
        const triggerReload = (reason: string) => {
            this.debugLog(`触发重载: ${reason}`);
            
            // 1.1 清除之前的定时器（实现节流）
            if (reloadTimer) {
                clearTimeout(reloadTimer);
            }
            
            // 1.2 设置新的定时器
            reloadTimer = window.setTimeout(() => {
                this.reloadVisibleMindMaps();  // 执行重新加载
                reloadTimer = null;             // 清空定时器引用
            }, 500);
        };
        
        // ============================================================
        // 2. 监听思源官方 EventBus 事件（主要检测方式）
        // ============================================================
        
        // --------------------------------------------------------
        // 2.1 监听 loaded-protyle-static 事件
        // --------------------------------------------------------
        // 触发场景：
        //   - 用户点击思源的刷新按钮
        //   - 打开新文档
        //   - 文档静态加载完成
        // 优先级：⭐⭐⭐⭐⭐（最重要）
        this.eventBus.on('loaded-protyle-static', (event) => {
            this.debugLog('检测到 loaded-protyle-static 事件（文档刷新）', event.detail);
            triggerReload('loaded-protyle-static');
        });
        
        // --------------------------------------------------------
        // 2.2 监听 loaded-protyle-dynamic 事件
        // --------------------------------------------------------
        // 触发场景：
        //   - 文档动态加载内容
        //   - 滚动加载更多内容
        // 优先级：⭐⭐⭐⭐
        this.eventBus.on('loaded-protyle-dynamic', (event) => {
            this.debugLog('检测到 loaded-protyle-dynamic 事件（文档动态加载）', event.detail);
            triggerReload('loaded-protyle-dynamic');
        });
        
        // ============================================================
        // 3. MutationObserver 兜底机制（备用检测方式）
        // ============================================================
        
        // 3.1 创建 MutationObserver 实例
        // 目的：捕获 EventBus 可能遗漏的场景
        const protyleObserver = new MutationObserver((mutations) => {
            let hasSignificantChange = false;
            
            // 3.2 检测是否有显著的 DOM 变化
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const element = node as Element;
                            
                            // 3.2.1 检查是否是 protyle 内容容器
                            // protyle-content 是思源编辑器的主要内容容器
                            // 当这个容器被添加时，说明文档正在切换或刷新
                            if (element.classList?.contains('protyle-content') || 
                                element.querySelector?.('.protyle-content')) {
                                hasSignificantChange = true;
                            }
                        }
                    });
                }
            }
            
            // 3.3 如果检测到显著变化，触发重载
            if (hasSignificantChange) {
                this.debugLog('检测到 protyle-content 容器变化（MutationObserver 兜底）');
                triggerReload('MutationObserver');
            }
        });
        
        // 3.4 启动 MutationObserver 监听
        protyleObserver.observe(document.body, {
            childList: true,   // 监听子节点的添加和删除
            subtree: true      // 监听所有后代节点
        });
        
        // ============================================================
        // 4. 完成初始化
        // ============================================================
        
        this.debugLog('文档切换和刷新监听已启动（EventBus + MutationObserver 双重保障）');
    }

    /**
     * 绑定思维导图容器的拖动调整高度功能
     */
    bindResizeHandle(resizeHandle: HTMLElement, container: HTMLElement, blockElement: HTMLElement) {
        let startY = 0;
        let startHeight = 0;
        let isResizing = false;
        let resizeTimer: number | null = null;

        const onMouseDown = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            
            isResizing = true;
            startY = e.clientY;
            startHeight = container.offsetHeight;
            
            // 添加全局样式，防止选中文本
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            
            // 绑定全局事件
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            
            const deltaY = e.clientY - startY;
            const newHeight = Math.max(200, Math.min(1200, startHeight + deltaY)); // 限制高度在 200-1200px 之间
            
            container.style.height = `${newHeight}px`;
            
            // 使用节流优化：拖动过程中每150ms更新一次思维导图画布大小
            if (resizeTimer) {
                clearTimeout(resizeTimer);
            }
            resizeTimer = window.setTimeout(() => {
                const blockId = blockElement.getAttribute('data-node-id');
                if (blockId && this.embeddedMindMaps.has(blockId)) {
                    const mindMap = this.embeddedMindMaps.get(blockId);
                    if (mindMap && typeof mindMap.resize === 'function') {
                        mindMap.resize();
                        this.debugLog('拖动中更新思维导图画布大小:', newHeight);
                    }
                }
            }, 150);
        };

        const onMouseUp = () => {
            if (!isResizing) return;
            
            isResizing = false;
            
            // 清除定时器
            if (resizeTimer) {
                clearTimeout(resizeTimer);
                resizeTimer = null;
            }
            
            // 恢复样式
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // 移除全局事件
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            
            // 保存高度到块属性
            const finalHeight = container.offsetHeight;
            blockElement.setAttribute('custom-mindmap-height', finalHeight.toString());
            
            // 触发思维导图画布调整和重新渲染
            const blockId = blockElement.getAttribute('data-node-id');
            if (blockId && this.embeddedMindMaps.has(blockId)) {
                const mindMap = this.embeddedMindMaps.get(blockId);
                if (mindMap) {
                    // 延迟执行，确保容器尺寸已完全更新
                    setTimeout(() => {
                        // 先调用 resize() 更新画布尺寸
                        if (typeof mindMap.resize === 'function') {
                            mindMap.resize();
                            this.debugLog('最终更新思维导图画布大小:', finalHeight);
                        }
                        // resize() 方法会自动触发重新渲染，无需再调用 render()
                    }, 50);
                }
            }
        };

        // 绑定鼠标按下事件
        resizeHandle.addEventListener('mousedown', onMouseDown);
    }

    /**
     * 为指定文档打开思维导图对话框（展开按钮调用）
     */
    async openDocMindMapDialogForDoc(docId: string, docTitle: string) {
        try {
            showMessage('正在加载思维导图...', 2000, 'info');

            const mindMapData = await parseDocumentBlocksToMindMap(docId, docTitle);
            const originalData = JSON.parse(JSON.stringify(mindMapData));

            const dialog = new Dialog({
                title: `${this.i18n.docMindMapActionName} - ${docTitle}`,
                content: `
                    <div class="doc-mind-map-container" style="width: 100%; height: 100%; position: relative;">
                        <div class="doc-mind-map-toolbar" style="position: absolute; top: 10px; right: 10px; z-index: 1000; display: flex; gap: 8px; background: var(--b3-theme-background); padding: 8px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                            <button id="docAddChildBtn" class="b3-button b3-button--outline" title="添加子节点 (Tab)">
                                <svg><use xlink:href="#iconAdd"></use></svg>
                                <span style="margin-left: 4px;">子节点</span>
                            </button>
                            <button id="docAddSiblingBtn" class="b3-button b3-button--outline" title="添加兄弟节点 (Enter)">
                                <svg><use xlink:href="#iconAdd"></use></svg>
                                <span style="margin-left: 4px;">兄弟</span>
                            </button>
                            <button id="docDeleteNodeBtn" class="b3-button b3-button--outline" title="删除节点 (Delete)">
                                <svg><use xlink:href="#iconTrashcan"></use></svg>
                                <span style="margin-left: 4px;">删除</span>
                            </button>
                            <div style="width: 1px; background: var(--b3-border-color);"></div>
                            <button id="docSaveBtn" class="b3-button b3-button--outline" title="保存到文档 (Ctrl+S)">
                                <svg><use xlink:href="#iconSave"></use></svg>
                                <span style="margin-left: 4px;">保存</span>
                            </button>
                            <button id="docResetBtn" class="b3-button b3-button--outline" title="重置为原始内容">
                                <svg><use xlink:href="#iconRefresh"></use></svg>
                                <span style="margin-left: 4px;">重置</span>
                            </button>
                        </div>
                        <div id="docMindMapContainer" style="width: 100%; height: 100%;"></div>
                    </div>
                `,
                width: '95vw',
                height: '95vh',
                destroyCallback: () => {
                    if (this.docMindMap) {
                        this.docMindMap.destroy();
                        this.docMindMap = null;
                    }
                }
            });

            setTimeout(() => {
                const container = dialog.element.querySelector("#docMindMapContainer");
                const dialogContainer = dialog.element.querySelector(".doc-mind-map-container");
                
                if (!container || !dialogContainer) {
                    showMessage('无法找到思维导图容器', 3000, 'error');
                    return;
                }

                this.docMindMap = new MindMap({
                    el: container,
                    data: mindMapData,
                    layout: 'logicalStructure',
                    themeConfig: {
                        backgroundColor: document.documentElement.getAttribute('data-theme-mode') === 'dark' ? '#1e1e1e' : '#fff',
                        rootTextColor: document.documentElement.getAttribute('data-theme-mode') === 'dark' ? '#fff' : '#000',
                        imgMaxWidth: 400,
                        imgMaxHeight: 300,
                        paddingX: 3,
                        paddingY: 3,
                        textContentMargin: 2,
                    },
                    readonly: false,
                    enableFreeDrag: false,
                    enableCtrlKeyNodeSelection: true,
                    customInnerElsAppendTo: dialogContainer,
                    imgResizeBtnSize: 20,
                    minImgResizeWidth: 50,
                    minImgResizeHeight: 30,
                    maxImgResizeWidthInheritTheme: false,
                    maxImgResizeWidth: 1000,
                    maxImgResizeHeight: 800,
                } as any);

                this.bindDocMindMapToolbarEvents(docId, originalData);
                this.bindDocMindMapEditEvents();
            }, 100);

        } catch (error) {
            this.debugError('打开思维导图失败:', error);
            showMessage(`打开失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 显示主题选择对话框
     * @param type 'doc' 表示文档思维导图，'tree' 表示文档树思维导图
     */
    showThemeDialog(type: 'doc' | 'tree' = 'doc') {
        const currentMindMap = type === 'tree' ? this.mindMap : this.docMindMap;
        if (!currentMindMap) {
            showMessage(`请先打开${type === 'tree' ? '文档树' : '文档'}思维导图`, 3000, 'error');
            return;
        }

        const themes = getThemeList();
        const currentTheme = currentMindMap.getTheme();
        
        // 生成主题选项HTML
        const themeOptionsHtml = themes.map(theme => {
            const isActive = theme.value === currentTheme ? 'checked' : '';
            return `
                <label class="b3-label" style="display: flex; align-items: center; padding: 8px; margin-bottom: 4px; cursor: pointer; border-radius: 4px; transition: background 0.2s;">
                    <input type="radio" name="themeOption" value="${theme.value}" ${isActive} class="b3-radio" style="margin-right: 8px;">
                    <div style="flex: 1;">
                        <div style="font-weight: ${isActive ? 'bold' : 'normal'};">${theme.name}</div>
                        ${theme.dark ? '<div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 2px;">深色主题</div>' : ''}
                    </div>
                </label>
            `;
        }).join('');

        const dialog = new Dialog({
            title: "选择主题",
            content: `
                <div class="b3-dialog__content" style="padding: 20px; max-height: 60vh; overflow-y: auto;">
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 12px; font-weight: bold;">可用主题：</label>
                        ${themeOptionsHtml}
                    </div>
                    <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--b3-border-color); color: var(--b3-theme-on-surface-light); font-size: 12px;">
                        💡 提示：您也可以在插件设置中配置默认主题
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel">取消</button>
                    <button id="applyTheme" class="b3-button b3-button--text">应用</button>
                </div>
            `,
            width: "450px",
        });

        setTimeout(() => {
            const applyBtn = document.getElementById('applyTheme');
            if (applyBtn) {
                applyBtn.addEventListener('click', async () => {
                    const selectedTheme = document.querySelector('input[name="themeOption"]:checked') as HTMLInputElement;
                    if (selectedTheme) {
                        const themeName = selectedTheme.value;
                        currentMindMap.setTheme(themeName);
                        
                        // 保存主题设置到配置
                        if (type === 'tree') {
                            await this.settingUtils.set(docTreeThemeName, themeName);
                        } else {
                            await this.settingUtils.set(docMindMapThemeName, themeName);
                        }
                        
                        showMessage(`已切换到 ${themes.find(t => t.value === themeName)?.name} 主题并保存`, 2000, 'info');
                        dialog.destroy();
                    }
                });
            }

            // 点击标签也能选中单选框
            const labels = dialog.element.querySelectorAll('label.b3-label');
            labels.forEach(label => {
                label.addEventListener('click', (e) => {
                    if (e.target !== label.querySelector('input')) {
                        const radio = label.querySelector('input[type="radio"]') as HTMLInputElement;
                        if (radio) {
                            radio.checked = true;
                        }
                    }
                });
            });
        }, 100);
    }

    /**
     * 显示导出对话框
     * @param type 'doc' 表示文档思维导图，'tree' 表示文档树思维导图
     */
    showExportDialog(type: 'doc' | 'tree' = 'doc') {
        const currentMindMap = type === 'tree' ? this.mindMap : this.docMindMap;
        if (!currentMindMap) {
            showMessage(`请先打开${type === 'tree' ? '文档树' : '文档'}思维导图`, 3000, 'error');
            return;
        }

        const dialog = new Dialog({
            title: "导出思维导图",
            content: `
                <div class="b3-dialog__content" style="padding: 20px;">
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px;">选择导出格式：</label>
                        <select id="exportFormat" class="b3-select" style="width: 100%;">
                            <option value="markdown">Markdown - 文本格式</option>
                            <option value="xmind">XMind - XMind格式</option>
                            <option value="pdf">PDF - 文档格式</option>
                            <option value="png">PNG - 图片格式</option>
                            <option value="svg">SVG - 矢量图格式</option>
                            <option value="json">JSON - simple-mind-map思维导图数据</option>
                            <option value="txt">TXT - 纯文本格式</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px;">文件名：</label>
                        <input id="exportFileName" type="text" class="b3-text-field" style="width: 100%;" value="mindmap" placeholder="请输入文件名">
                    </div>
                    <div id="removeStyleOption" style="margin-bottom: 16px; display: none;">
                        <label class="b3-label" style="display: flex; align-items: center;">
                            <input id="removeStyleCheckbox" type="checkbox" class="b3-checkbox">
                            <span style="margin-left: 8px;">去除HTML样式（只保留纯文本）</span>
                        </label>
                    </div>
                    <div id="imageSaveModeOption" style="margin-bottom: 16px; display: none;">
                        <label style="display: block; margin-bottom: 8px;">图片保存方式：</label>
                        <select id="imageSaveMode" class="b3-select" style="width: 100%;">
                            <option value="relative">思源相对路径（默认）</option>
                            <option value="absolute">图片绝对路径</option>
                            <option value="copy">复制图片资源（导出到文件夹）</option>
                        </select>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel">取消</button>
                    <button id="confirmExport" class="b3-button b3-button--text">导出</button>
                </div>
            `,
            width: "450px",
        });

        setTimeout(() => {
            const formatSelect = document.getElementById('exportFormat') as HTMLSelectElement;
            const removeStyleOption = document.getElementById('removeStyleOption') as HTMLDivElement;
            const imageSaveModeOption = document.getElementById('imageSaveModeOption') as HTMLDivElement;
            
            // 根据选择的格式显示/隐藏选项
            const updateOptions = () => {
                const format = formatSelect?.value;
                
                // 去除样式选项：json、txt 格式显示
                if (format === 'json' || format === 'txt') {
                    removeStyleOption.style.display = 'block';
                } else {
                    removeStyleOption.style.display = 'none';
                }
                
                // 图片保存方式选项：markdown、json、txt 格式显示
                if (format === 'markdown' || format === 'json' || format === 'txt') {
                    imageSaveModeOption.style.display = 'block';
                } else {
                    imageSaveModeOption.style.display = 'none';
                }
            };
            
            // 初始化选项显示
            updateOptions();
            
            // 监听格式变化
            formatSelect?.addEventListener('change', updateOptions);
            
            const confirmBtn = document.getElementById('confirmExport');
            if (confirmBtn) {
                confirmBtn.addEventListener('click', async () => {
                    const format = formatSelect?.value;
                    const fileName = (document.getElementById('exportFileName') as HTMLInputElement)?.value || 'mindmap';
                    const removeStyle = (document.getElementById('removeStyleCheckbox') as HTMLInputElement)?.checked || false;
                    const imageSaveMode = (document.getElementById('imageSaveMode') as HTMLSelectElement)?.value || 'relative';
                    
                    dialog.destroy();
                    await this.exportMindMap(format, fileName, type, { removeStyle, imageSaveMode });
                });
            }
            
            // 取消按钮
            const cancelBtn = dialog.element.querySelector('.b3-button--cancel');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => dialog.destroy());
            }
        }, 100);
    }

    /**
     * 导出思维导图
     * @param type 'doc' 表示文档思维导图，'tree' 表示文档树思维导图
     */
    async exportMindMap(format: string, fileName: string, type: 'doc' | 'tree' = 'doc', options: { removeStyle?: boolean; imageSaveMode?: string } = {}) {
        try {
            showMessage(`正在导出为 ${format.toUpperCase()} 格式...`, 2000, 'info');
            
            switch (format) {
                case 'json':
                    await this.exportJSON(fileName, type, options);
                    break;
                case 'png':
                    await this.exportPNG(fileName, type);
                    break;
                case 'svg':
                    await this.exportSVG(fileName, type);
                    break;
                case 'pdf':
                    await this.exportPDF(fileName, type);
                    break;
                case 'markdown':
                    await this.exportMarkdown(fileName, type, options);
                    break;
                case 'xmind':
                    await this.exportXMind(fileName, type);
                    break;
                case 'txt':
                    await this.exportTXT(fileName, type, options);
                    break;
                default:
                    showMessage('不支持的导出格式', 3000, 'error');
            }
        } catch (error) {
            this.debugError('导出失败:', error);
            showMessage(`导出失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 导出为 JSON
     */
    async exportJSON(fileName: string, type: 'doc' | 'tree' = 'doc', options: { removeStyle?: boolean; imageSaveMode?: string } = {}) {
        const mindMap = type === 'tree' ? this.mindMap : this.docMindMap;
        const originalData = mindMap.getData();
        
        // 如果需要复制图片，使用 ZIP 打包导出
        if (options.imageSaveMode === 'copy') {
            // 处理数据：只去除样式，不转换图片路径
            let data = originalData;
            if (options.removeStyle) {
                data = await this.processNodeData(data, true, 'relative');
            }
            const jsonStr = JSON.stringify(data, null, 2);
            // 传入原始数据用于收集图片路径
            await this.exportWithImages(jsonStr, fileName, '.json', originalData);
        } else {
            // 处理数据：去除样式和处理图片路径
            let data = originalData;
            if (options.removeStyle || options.imageSaveMode) {
                data = await this.processNodeData(data, options.removeStyle || false, options.imageSaveMode || 'relative');
            }
            
            const jsonStr = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            this.downloadFile(blob, `${fileName}.json`);
            showMessage('JSON 导出成功', 2000, 'info');
        }
    }

    /**
     * 导出为 PNG
     */
    async exportPNG(fileName: string, type: 'doc' | 'tree' = 'doc') {
        try {
            const mindMap = type === 'tree' ? this.mindMap : this.docMindMap;
            // 导出（使用初始化时配置的 exportPaddingX 和 exportPaddingY）
            const data = await mindMap.export('png', false);
            
            // 手动处理下载
            if (typeof data === 'string') {
                // Data URL
                const link = document.createElement('a');
                link.href = data;
                link.download = `${fileName}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else if (data instanceof Blob) {
                this.downloadFile(data, `${fileName}.png`);
            }
            
            showMessage('PNG 导出成功', 2000, 'info');
        } catch (error) {
            this.debugError('PNG 导出失败:', error);
            showMessage(`PNG 导出失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 导出为 SVG
     */
    async exportSVG(fileName: string, type: 'doc' | 'tree' = 'doc') {
        try {
            const mindMap = type === 'tree' ? this.mindMap : this.docMindMap;
            // 导出（使用初始化时配置的 exportPaddingX 和 exportPaddingY）
            const data = await mindMap.export('svg', false);
            
            // 手动处理下载
            if (typeof data === 'string') {
                // SVG 字符串
                const blob = new Blob([data], { type: 'image/svg+xml' });
                this.downloadFile(blob, `${fileName}.svg`);
            } else if (data instanceof Blob) {
                this.downloadFile(data, `${fileName}.svg`);
            }
            
            showMessage('SVG 导出成功', 2000, 'info');
        } catch (error) {
            this.debugError('SVG 导出失败:', error);
            showMessage(`SVG 导出失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 导出为 PDF
     */
    async exportPDF(fileName: string, type: 'doc' | 'tree' = 'doc') {
        try {
            const mindMap = type === 'tree' ? this.mindMap : this.docMindMap;
            // 导出（使用初始化时配置的 exportPaddingX 和 exportPaddingY）
            const data = await mindMap.export('pdf', false);
            
            // 手动处理下载
            if (data instanceof Blob) {
                this.downloadFile(data, `${fileName}.pdf`);
            } else if (data instanceof ArrayBuffer) {
                const blob = new Blob([data], { type: 'application/pdf' });
                this.downloadFile(blob, `${fileName}.pdf`);
            } else if (typeof data === 'string') {
                const link = document.createElement('a');
                link.href = data;
                link.download = `${fileName}.pdf`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
            
            showMessage('PDF 导出成功', 2000, 'info');
        } catch (error) {
            this.debugError('PDF 导出失败:', error);
            showMessage(`PDF 导出失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 导出为 Markdown
     */
    async exportMarkdown(fileName: string, type: 'doc' | 'tree' = 'doc', options: { imageSaveMode?: string } = {}) {
        const mindMap = type === 'tree' ? this.mindMap : this.docMindMap;
        const originalData = mindMap.getData();
        
        // 如果需要复制图片，使用 ZIP 打包导出
        if (options.imageSaveMode === 'copy') {
            // 先用原始数据生成 markdown（保持原始图片路径）
            const markdown = this.convertMindMapToCleanMarkdown(originalData);
            // 传入原始数据用于收集图片路径
            await this.exportWithImages(markdown, fileName, '.md', originalData);
        } else {
            // 处理图片路径
            let data = originalData;
            if (options.imageSaveMode) {
                data = await this.processNodeData(data, false, options.imageSaveMode);
            }
            
            const markdown = this.convertMindMapToCleanMarkdown(data);
            const blob = new Blob([markdown], { type: 'text/markdown' });
            this.downloadFile(blob, `${fileName}.md`);
            showMessage('Markdown 导出成功', 2000, 'info');
        }
    }

    /**
     * 导出为 XMind
     */
    async exportXMind(fileName: string, type: 'doc' | 'tree' = 'doc') {
        try {
            const mindMap = type === 'tree' ? this.mindMap : this.docMindMap;
            // XMind 格式不是图片，不需要调整边距，直接导出即可
            const data = await mindMap.export('xmind', false);
            
            // 手动处理下载
            if (data instanceof Blob) {
                this.downloadFile(data, `${fileName}.xmind`);
            } else if (typeof data === 'string') {
                const link = document.createElement('a');
                link.href = data;
                link.download = `${fileName}.xmind`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
            
            showMessage('XMind 导出成功', 2000, 'info');
        } catch (error) {
            this.debugError('XMind 导出失败:', error);
            showMessage(`XMind 导出失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 导出为 TXT
     */
    async exportTXT(fileName: string, type: 'doc' | 'tree' = 'doc', options: { removeStyle?: boolean; imageSaveMode?: string } = {}) {
        const mindMap = type === 'tree' ? this.mindMap : this.docMindMap;
        const originalData = mindMap.getData();
        
        // 如果需要复制图片，使用 ZIP 打包导出
        if (options.imageSaveMode === 'copy') {
            // 处理数据：只去除样式，不转换图片路径
            let data = originalData;
            if (options.removeStyle) {
                data = await this.processNodeData(data, true, 'relative');
            }
            const text = this.convertMindMapToText(data);
            // 传入原始数据用于收集图片路径
            await this.exportWithImages(text, fileName, '.txt', originalData);
        } else {
            // 处理数据：去除样式和处理图片路径
            let data = originalData;
            if (options.removeStyle || options.imageSaveMode) {
                data = await this.processNodeData(data, options.removeStyle || false, options.imageSaveMode || 'relative');
            }
            
            const text = this.convertMindMapToText(data);
            const blob = new Blob([text], { type: 'text/plain' });
            this.downloadFile(blob, `${fileName}.txt`);
            showMessage('TXT 导出成功', 2000, 'info');
        }
    }

    /**
     * 将思维导图转换为纯文本
     */
    convertMindMapToText(data: any, level: number = 0): string {
        if (!data) return '';
        
        const indent = '  '.repeat(level);
        const nodeData = data.data || {};
        
        // 获取节点文本
        let nodeText = this.getCleanNodeText(nodeData) || '';
        
        // 如果有图片，添加图片路径信息
        if (nodeData.image) {
            if (nodeText) {
                nodeText += ` [图片: ${nodeData.image}]`;
            } else {
                nodeText = `[图片: ${nodeData.image}]`;
            }
        }
        
        let text = indent + nodeText + '\n';
        
        // 如果有备注，添加备注
        if (nodeData.note) {
            const cleanNote = this.stripHtmlTags(nodeData.note);
            if (cleanNote) {
                text += indent + '  备注: ' + cleanNote + '\n';
            }
        }
        
        if (data.children && data.children.length > 0) {
            for (const child of data.children) {
                text += this.convertMindMapToText(child, level + 1);
            }
        }
        
        return text;
    }

    /**
     * 下载文件
     */
    downloadFile(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * 显示导入对话框
     */
    showImportDialog() {
        if (!this.docMindMap) {
            showMessage('请先打开文档思维导图', 3000, 'error');
            return;
        }

        const dialog = new Dialog({
            title: "导入思维导图",
            content: `
                <div class="b3-dialog__content" style="padding: 20px;">
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px;">选择导入格式：</label>
                        <select id="importFormat" class="b3-select" style="width: 100%; margin-bottom: 12px;">
                            <option value="xmind">XMind - XMind格式（可导入图片）</option>
                            <option value="json">JSON - simple-mind-map思维导图数据（不能解析图片）</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px;">选择文件：</label>
                        <input id="importFile" type="file" class="b3-text-field" style="width: 100%;">
                    </div>
                    <div style="padding: 12px; background: var(--b3-card-warning-background); border-radius: 4px; font-size: 12px;">
                        ⚠️ 导入将替换当前思维导图内容，建议先导出备份
                    </div>
                    <div style="padding: 12px; background: var(--b3-card-info-background); border-radius: 4px; font-size: 12px; margin-top: 8px;">
                        💡 导入Markdown文件，请使用思源笔记官方的导入Markdown功能
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel">取消</button>
                    <button id="confirmImport" class="b3-button b3-button--text">导入</button>
                </div>
            `,
            width: "450px",
        });

        setTimeout(() => {
            const formatSelect = document.getElementById('importFormat') as HTMLSelectElement;
            const fileInput = document.getElementById('importFile') as HTMLInputElement;
            const confirmBtn = document.getElementById('confirmImport');
            
                // 根据选择的格式更新文件选择器的accept属性
                const updateFileAccept = () => {
                    const format = formatSelect?.value;
                    if (!fileInput) return;
                    
                    switch (format) {
                        case 'xmind':
                            fileInput.accept = '.xmind';
                            break;
                        case 'json':
                            fileInput.accept = '.json';
                            break;
                        default:
                            fileInput.accept = '';
                    }
                };
            
            // 初始化文件类型
            updateFileAccept();
            
            // 监听格式选择变化
            if (formatSelect) {
                formatSelect.addEventListener('change', updateFileAccept);
            }
            
            if (confirmBtn) {
                confirmBtn.addEventListener('click', async () => {
                    const format = formatSelect?.value;
                    const file = fileInput?.files?.[0];
                    
                    if (!file) {
                        showMessage('请选择要导入的文件', 3000, 'error');
                        return;
                    }
                    
                    dialog.destroy();
                    await this.importMindMap(format, file);
                });
            }
            
            // 取消按钮
            const cancelBtn = dialog.element.querySelector('.b3-button--cancel');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => dialog.destroy());
            }
        }, 100);
    }

    /**
     * 导入思维导图
     */
    async importMindMap(format: string, file: File) {
        try {
            showMessage(`正在导入 ${format.toUpperCase()} 格式...`, 2000, 'info');
            
            switch (format) {
                case 'xmind':
                    await this.importXMind(file);
                    break;
                case 'json':
                    await this.importJSON(file);
                    break;
                default:
                    showMessage('不支持的导入格式', 3000, 'error');
            }
        } catch (error) {
            this.debugError('导入失败:', error);
            showMessage(`导入失败: ${error.message}`, 3000, 'error');
        }
    }

    /**
     * 导入 JSON
     */
    async importJSON(file: File) {
        const text = await file.text();
        const data = JSON.parse(text);
        this.docMindMap.setData(data);
        this.docMindMap.render();
        showMessage('JSON 导入成功', 2000, 'info');
    }

    /**
     * 导入 XMind
     */
    async importXMind(file: File) {
        try {
            // 使用 simple-mind-map 的 xmind 解析方法
            const data = await xmind.parseXmindFile(file);
            
            // 将解析后的数据设置到思维导图中
            this.docMindMap.setData(data);
            this.docMindMap.render();
            
            showMessage('XMind 导入成功', 2000, 'info');
        } catch (error) {
            this.debugError('XMind 导入失败:', error);
            showMessage(`XMind 导入失败: ${error.message}`, 3000, 'error');
        }
    }

}
