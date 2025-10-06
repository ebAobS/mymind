/**
 * 文档 Markdown 解析器
 * 通过 /api/export/exportMdContent 获取文档的 Markdown 内容
 * 然后解析为思维导图节点结构
 * 参考文档：https://leolee9086.github.io/siyuan-kernelApi-docs/export/exportMdContent.html
 */

import * as api from "@/api";

interface MindMapNode {
    data: {
        text: string;
        uid?: string;
        richText?: boolean;
        image?: string;
        imageSize?: {
            width: number;
            height: number;
            custom?: boolean; // 标记是否是用户自定义的尺寸
        };
    };
    children?: MindMapNode[];
}

/**
 * 移除 Markdown 文本开头的 YAML Front Matter
 * @param markdown 原始 Markdown 文本
 * @returns 移除前置元数据后的 Markdown 文本
 */
function removeFrontMatter(markdown: string): string {
    const lines = markdown.split('\n');
    
    // 检查是否以 --- 开头
    if (lines.length > 0 && lines[0].trim() === '---') {
        // 查找第二个 ---
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                // 返回从第二个 --- 之后的内容
                return lines.slice(i + 1).join('\n');
            }
        }
    }
    
    // 没有 Front Matter，返回原文本
    return markdown;
}

/**
 * 解析 Markdown 文本为思维导图节点树
 * @param markdown Markdown 文本
 * @param title 文档标题
 * @returns 思维导图根节点
 */
function parseMarkdownToTree(markdown: string, title: string): MindMapNode {
    // 移除 YAML Front Matter
    markdown = removeFrontMatter(markdown);
    
    const lines = markdown.split('\n');
    
    // 根节点
    const rootNode: MindMapNode = {
        data: {
            text: title,
            uid: 'root'
        },
        children: []
    };
    
    // 节点栈，用于处理层级关系
    // 每个元素包含：节点对象、层级（标题级别、列表缩进等）
    interface StackItem {
        node: MindMapNode;
        level: number;
        type: 'heading' | 'list' | 'root';
    }
    
    const stack: StackItem[] = [
        { node: rootNode, level: 0, type: 'root' }
    ];
    
    let nodeIdCounter = 0;
    let inCodeBlock = false;
    let codeBlockContent: string[] = [];
    let codeBlockLang = '';
    let currentParagraph: string[] = [];
    let isFirstHeading = true; // 标记是否是第一个标题
    
    const addParagraphNode = () => {
        if (currentParagraph.length > 0) {
            let text = currentParagraph.join('\n').trim();
            if (text) {
                // 先检查是否有图片
                const imageUrl = extractImageUrl(text);
                
                // 清理文本（移除图片语法）
                text = cleanMarkdownText(text);
                
                // 如果有图片，即使没有文本也创建节点（文本为空字符串）
                // 如果没有图片但有文本，正常创建节点
                if (imageUrl || text) {
                    const node = createNode(text || '', ++nodeIdCounter, 'paragraph');
                    if (imageUrl) {
                        node.data.image = imageUrl;
                        // 临时尺寸，稍后会被真实尺寸替换
                        node.data.imageSize = { width: 300, height: 300, custom: false };
                    }
                    addToParent(stack, node, 0, 'paragraph');
                }
            }
            currentParagraph = [];
        }
    };
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // 处理代码块
        if (line.trim().startsWith('```')) {
            if (!inCodeBlock) {
                // 开始代码块
                inCodeBlock = true;
                codeBlockLang = line.trim().substring(3).trim();
                codeBlockContent = [];
                addParagraphNode(); // 先添加之前的段落
            } else {
                // 结束代码块
                inCodeBlock = false;
                const codeText = codeBlockContent.join('\n');
                const preview = codeText.substring(0, 100);
                const displayText = `💻 [${codeBlockLang || '代码块'}]\n${preview}${codeText.length > 100 ? '...' : ''}`;
                const node = createNode(displayText, ++nodeIdCounter, 'code');
                addToParent(stack, node, 0, 'code');
                codeBlockContent = [];
                codeBlockLang = '';
            }
            continue;
        }
        
        if (inCodeBlock) {
            codeBlockContent.push(line);
            continue;
        }
        
        // 匹配标题 (# 开头)
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            addParagraphNode(); // 先添加之前的段落
            
            const level = headingMatch[1].length; // 标题级别 (1-6)
            let text = headingMatch[2].trim();
            
            // 先检查是否有图片（在清理文本之前）
            const imageUrl = extractImageUrl(text);
            
            // 清理文本（移除图片语法）
            text = cleanMarkdownText(text);
            
            // 如果是第一个标题，并且与文档标题相同，则跳过
            if (isFirstHeading && text === title) {
                isFirstHeading = false;
                continue;
            }
            isFirstHeading = false;
            
            // 创建标题节点
            const node = createNode(text || '', ++nodeIdCounter, 'heading');
            if (imageUrl) {
                node.data.image = imageUrl;
                // imageSize 设置为较大的默认值，让图片保持原始比例
                // 临时尺寸，稍后会被真实尺寸替换
                node.data.imageSize = { width: 300, height: 300, custom: false };
            }
            
            // 调整栈：移除所有 level >= 当前标题 level 的节点
            // 但要确保只在标题类型或根节点中查找父节点
            while (stack.length > 1) {
                const top = stack[stack.length - 1];
                // 如果栈顶是列表节点，或者是 level >= 当前 level 的标题节点，则弹出
                if (top.type === 'list' || (top.type === 'heading' && top.level >= level)) {
                    stack.pop();
                } else {
                    break;
                }
            }
            
            // 添加到父节点（应该是根节点或更低级别的标题节点）
            if (stack.length > 0) {
                const parent = stack[stack.length - 1].node;
                if (!parent.children) {
                    parent.children = [];
                }
                parent.children.push(node);
            }
            
            // 将当前节点压入栈
            stack.push({ node: node, level: level, type: 'heading' });
            continue;
        }
        
        // 匹配无序列表 (-, *, + 开头)
        const listMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);
        if (listMatch) {
            addParagraphNode(); // 先添加之前的段落
            
            const indent = listMatch[1].length;
            const level = Math.floor(indent / 2); // 每2个空格为一级
            let text = listMatch[3].trim();
            
            // 先检查是否有图片
            const imageUrl = extractImageUrl(text);
            
            // 清理文本（移除图片语法）
            text = cleanMarkdownText(text);
            
            // 创建列表项节点（直接显示文本内容，不添加圆点）
            const node = createNode(text || '', ++nodeIdCounter, 'list');
            if (imageUrl) {
                node.data.image = imageUrl;
                // imageSize 设置为较大的默认值，让图片保持原始比例
                // 临时尺寸，稍后会被真实尺寸替换
                node.data.imageSize = { width: 300, height: 300, custom: false };
            }
            
            addToParent(stack, node, level, 'list');
            continue;
        }
        
        // 匹配有序列表 (数字. 开头)
        const orderedListMatch = line.match(/^(\s*)(\d+\.)\s+(.+)$/);
        if (orderedListMatch) {
            addParagraphNode(); // 先添加之前的段落
            
            const indent = orderedListMatch[1].length;
            const level = Math.floor(indent / 2);
            let text = orderedListMatch[3].trim();
            
            // 先检查是否有图片
            const imageUrl = extractImageUrl(text);
            
            // 清理文本（移除图片语法）
            text = cleanMarkdownText(text);
            
            // 创建列表项节点（直接显示文本内容，不添加数字序号）
            const node = createNode(text || '', ++nodeIdCounter, 'list');
            if (imageUrl) {
                node.data.image = imageUrl;
                // imageSize 设置为较大的默认值，让图片保持原始比例
                // 临时尺寸，稍后会被真实尺寸替换
                node.data.imageSize = { width: 300, height: 300, custom: false };
            }
            
            addToParent(stack, node, level, 'list');
            continue;
        }
        
        // 匹配引用 (> 开头)
        const quoteMatch = line.match(/^>\s+(.+)$/);
        if (quoteMatch) {
            addParagraphNode(); // 先添加之前的段落
            
            let text = quoteMatch[1].trim();
            text = cleanMarkdownText(text);
            
            const displayText = '❝ ' + text;
            const node = createNode(displayText, ++nodeIdCounter, 'quote');
            addToParent(stack, node, 0, 'quote');
            continue;
        }
        
        // 匹配分割线
        if (line.trim().match(/^[-*_]{3,}$/)) {
            addParagraphNode();
            const node = createNode('---', ++nodeIdCounter, 'divider');
            addToParent(stack, node, 0, 'divider');
            continue;
        }
        
        // 空行，结束当前段落
        if (line.trim() === '') {
            addParagraphNode();
            continue;
        }
        
        // 普通文本行，累积到段落
        const trimmedLine = line.trim();
        if (trimmedLine) {
            currentParagraph.push(trimmedLine);
        }
    }
    
    // 添加最后一个段落
    addParagraphNode();
    
    // 如果没有任何子节点，添加提示
    if (!rootNode.children || rootNode.children.length === 0) {
        rootNode.children = [{
            data: {
                text: '该文档暂无内容',
                uid: 'empty-hint'
            }
        }];
    }
    
    return rootNode;
}

/**
 * 创建节点
 */
function createNode(text: string, id: number, type: string): MindMapNode {
    // 限制文本长度
    if (text.length > 200) {
        text = text.substring(0, 197) + '...';
    }
    
    return {
        data: {
            text: text,
            uid: `${type}-${id}`,
            richText: false
        },
        children: []
    };
}

/**
 * 将节点添加到合适的父节点
 */
function addToParent(
    stack: Array<{ node: MindMapNode; level: number; type: string }>,
    node: MindMapNode,
    level: number,
    nodeType: string
) {
    // 对于列表项，找到同类型且级别合适的父节点
    if (nodeType === 'list') {
        // 调整栈：移除所有级别 >= 当前级别的列表节点
        while (stack.length > 1) {
            const top = stack[stack.length - 1];
            if (top.type === 'list' && top.level >= level) {
                stack.pop();
            } else {
                break;
            }
        }
        
        // 添加到栈顶节点（应该是标题节点或根节点）
        const parent = stack[stack.length - 1].node;
        if (!parent.children) {
            parent.children = [];
        }
        parent.children.push(node);
        
        // 将当前节点压入栈（作为潜在的父节点）
        stack.push({ node: node, level: level, type: 'list' });
    } else {
        // 其他类型的节点（段落、引用、分割线等），清理栈中的所有列表节点
        // 添加到最近的标题节点或根节点
        while (stack.length > 1 && stack[stack.length - 1].type === 'list') {
            stack.pop();
        }
        
        const parent = stack[stack.length - 1].node;
        if (!parent.children) {
            parent.children = [];
        }
        parent.children.push(node);
    }
}

/**
 * 清理 Markdown 文本中的格式化语法
 * @param text 原始文本
 * @param removeImages 是否移除图片语法，默认为 true
 * @returns 清理后的文本
 */
function cleanMarkdownText(text: string, removeImages: boolean = true): string {
    // 移除图片 ![alt](url) - 如果需要的话
    if (removeImages) {
        text = text.replace(/!\[.*?\]\([^)]+\)/g, '');
    }
    
    // 移除加粗 **text** 或 __text__
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
    
    // 移除斜体 *text* 或 _text_（但不影响列表标记）
    text = text.replace(/(?<!\*)\*(?!\*)([^*]+)\*/g, '$1');
    text = text.replace(/(?<!_)_(?!_)([^_]+)_/g, '$1');
    
    // 移除删除线 ~~text~~
    text = text.replace(/~~(.*?)~~/g, '$1');
    
    // 移除行内代码 `code`
    text = text.replace(/`([^`]+)`/g, '$1');
    
    // 移除链接，保留文本 [text](url)
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    
    // 移除 HTML 标签
    text = text.replace(/<[^>]+>/g, '');
    
    // 清理多余的空格
    text = text.replace(/\s+/g, ' ');
    
    return text.trim();
}

/**
 * 从文本中提取图片 URL（返回第一个图片）
 * @param text Markdown 文本
 * @returns 图片 URL 或 null
 */
function extractImageUrl(text: string): string | null {
    // 匹配 Markdown 图片语法 ![alt](url)
    const match = text.match(/!\[.*?\]\(([^)]+)\)/);
    if (match && match[1]) {
        let url = match[1].trim();
        
        // 处理思源笔记的相对路径
        // 思源笔记的资源路径直接使用，不需要添加前缀
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            // 相对路径，确保以 / 开头
            if (!url.startsWith('/')) {
                url = '/' + url;
            }
        }
        
        return url;
    }
    
    return null;
}

/**
 * 获取图片的真实尺寸
 * @param url 图片 URL
 * @returns Promise<{width, height}> 图片尺寸
 */
async function getImageSize(url: string): Promise<{width: number, height: number}> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            resolve({
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height
            });
        };
        img.onerror = () => {
            // 图片加载失败时返回默认尺寸
            resolve({ width: 300, height: 300 });
        };
        img.src = url;
    });
}

/**
 * 递归遍历节点树，获取所有图片的真实尺寸
 * @param node 节点
 */
async function updateImageSizes(node: MindMapNode): Promise<void> {
    const promises: Promise<void>[] = [];
    
    // 如果当前节点有图片，获取其真实尺寸
    if (node.data.image) {
        const promise = getImageSize(node.data.image).then(size => {
            node.data.imageSize = {
                width: size.width,
                height: size.height,
                custom: false
            };
        });
        promises.push(promise);
    }
    
    // 递归处理子节点
    if (node.children && node.children.length > 0) {
        for (const child of node.children) {
            promises.push(updateImageSizes(child));
        }
    }
    
    await Promise.all(promises);
}

/**
 * 将文档块树转换为思维导图节点
 * 使用 /api/export/exportMdContent 获取 Markdown 内容
 * @param docId 文档ID
 * @param docTitle 文档标题
 * @returns 思维导图根节点
 */
export async function parseDocumentBlocksToMindMap(docId: string, docTitle: string): Promise<MindMapNode> {
    try {
        // 调用 API 获取文档的 Markdown 内容
        const result = await api.exportMdContent(docId);
        
        if (!result || !result.content) {
            return {
                data: {
                    text: docTitle,
                    uid: 'root'
                },
                children: [{
                    data: {
                        text: '获取文档内容失败',
                        uid: 'error-hint'
                    }
                }]
            };
        }
        
        // 解析 Markdown 为思维导图节点树
        const mindMapData = parseMarkdownToTree(result.content, docTitle);
        
        // 异步获取所有图片的真实尺寸
        await updateImageSizes(mindMapData);
        
        return mindMapData;
    } catch (error) {
        console.error('解析文档失败:', error);
        return {
            data: {
                text: docTitle,
                uid: 'root'
            },
            children: [{
                data: {
                    text: '解析失败: ' + error.message,
                    uid: 'error-hint'
                }
            }]
        };
    }
}
