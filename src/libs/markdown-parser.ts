/**
 * Markdown 解析器，将 markdown 文本转换为 simple-mind-map 的节点格式
 */

interface MindMapNode {
    data: {
        text: string;
        uid?: string;
    };
    children?: MindMapNode[];
}

/**
 * 解析 markdown 标题，转换为思维导图节点
 * @param markdown markdown 文本
 * @param title 文档标题（作为根节点）
 * @returns simple-mind-map 节点数据
 */
export function parseMarkdownToMindMap(markdown: string, title: string): MindMapNode {
    // 分割为行
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
    // 栈中每个元素包含：节点对象、标题层级
    const stack: Array<{ node: MindMapNode; level: number }> = [
        { node: rootNode, level: 0 }
    ];
    
    let nodeIdCounter = 0;
    
    for (const line of lines) {
        // 匹配标题行 (# 开头)
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        
        if (headerMatch) {
            const level = headerMatch[1].length; // 标题层级 (1-6)
            let text = headerMatch[2].trim();
            
            // 清理文本，移除可能的 markdown 语法
            text = cleanMarkdownText(text);
            
            // 如果文本太长，进行截断
            if (text.length > 80) {
                text = text.substring(0, 77) + '...';
            }
            
            // 创建新节点
            const newNode: MindMapNode = {
                data: {
                    text: text,
                    uid: `node-${++nodeIdCounter}`
                },
                children: []
            };
            
            // 找到合适的父节点（栈中层级小于当前层级的最近节点）
            while (stack.length > 0 && stack[stack.length - 1].level >= level) {
                stack.pop();
            }
            
            // 添加到父节点
            if (stack.length > 0) {
                const parent = stack[stack.length - 1].node;
                if (!parent.children) {
                    parent.children = [];
                }
                parent.children.push(newNode);
            }
            
            // 将当前节点压入栈
            stack.push({ node: newNode, level: level });
        }
    }
    
    // 如果没有任何子节点，添加一个提示节点
    if (!rootNode.children || rootNode.children.length === 0) {
        rootNode.children = [{
            data: {
                text: '该文档暂无标题结构',
                uid: 'empty-hint'
            }
        }];
    }
    
    return rootNode;
}

/**
 * 清理 markdown 文本中的格式化语法
 * @param text 原始文本
 * @returns 清理后的文本
 */
function cleanMarkdownText(text: string): string {
    // 移除加粗 **text** 或 __text__
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
    
    // 移除斜体 *text* 或 _text_
    text = text.replace(/(\*|_)(.*?)\1/g, '$2');
    
    // 移除删除线 ~~text~~
    text = text.replace(/~~(.*?)~~/g, '$1');
    
    // 移除行内代码 `code`
    text = text.replace(/`([^`]+)`/g, '$1');
    
    // 移除链接 [text](url)
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    
    // 移除图片 ![alt](url)，只保留 alt 文本（如果有）
    text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1');
    
    // 移除 HTML 标签
    text = text.replace(/<[^>]+>/g, '');
    
    return text.trim();
}

/**
 * 从标题层级结构创建扁平的列表视图（备用方案）
 * @param markdown markdown 文本
 * @param title 文档标题
 * @returns simple-mind-map 节点数据
 */
export function parseMarkdownToFlatList(markdown: string, title: string): MindMapNode {
    const lines = markdown.split('\n');
    
    const rootNode: MindMapNode = {
        data: {
            text: title,
            uid: 'root'
        },
        children: []
    };
    
    let nodeIdCounter = 0;
    let contentBuffer: string[] = [];
    
    for (const line of lines) {
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        
        if (headerMatch) {
            let text = headerMatch[2].trim();
            text = cleanMarkdownText(text);
            
            if (text.length > 80) {
                text = text.substring(0, 77) + '...';
            }
            
            rootNode.children?.push({
                data: {
                    text: text,
                    uid: `node-${++nodeIdCounter}`
                }
            });
        }
    }
    
    if (!rootNode.children || rootNode.children.length === 0) {
        rootNode.children = [{
            data: {
                text: '该文档暂无标题结构',
                uid: 'empty-hint'
            }
        }];
    }
    
    return rootNode;
}

