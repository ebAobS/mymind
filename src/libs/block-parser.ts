/**
 * ????????????
 * ????????????????????????????
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
            custom?: boolean;
        };
        blockId?: string;
        blockType?: BlockType;
        blockSubType?: BlockSubType;
    };
    children?: MindMapNode[];
}

/**
 * ?? Markdown ?????????
 */
function cleanMarkdownText(text: string, removeImages: boolean = true): string {
    if (removeImages) {
        text = text.replace(/!\[.*?\]\([^)]+\)/g, "");
    }

    text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
    text = text.replace(/(?<!\*)\*(?!\*)([^*]+)\*/g, "$1");
    text = text.replace(/(?<!_)_(?!_)([^_]+)_/g, "$1");
    text = text.replace(/~~(.*?)~~/g, "$1");
    text = text.replace(/`([^`]+)`/g, "$1");
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1");
    text = text.replace(/<[^>]+>/g, "");
    text = text.replace(/\s+/g, " ");

    return text.trim();
}

/**
 * ???????? URL?????????
 */
function extractImageUrl(text: string): string | null {
    const match = text.match(/!\[.*?\]\(([^)]+)\)/);
    if (match && match[1]) {
        let url = match[1].trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            if (!url.startsWith("/")) {
                url = "/" + url;
            }
        }
        return url;
    }
    return null;
}

async function getImageSize(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            resolve({
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
            });
        };
        img.onerror = () => {
            resolve({ width: 300, height: 300 });
        };
        img.src = url;
    });
}

async function updateImageSizes(node: MindMapNode): Promise<void> {
    const promises: Promise<void>[] = [];

    if (node.data.image) {
        const promise = getImageSize(node.data.image).then((size) => {
            node.data.imageSize = {
                width: size.width,
                height: size.height,
                custom: false,
            };
        });
        promises.push(promise);
    }

    if (node.children && node.children.length > 0) {
        for (const child of node.children) {
            promises.push(updateImageSizes(child));
        }
    }

    await Promise.all(promises);
}

function extractBlockContent(kramdown: string, blockSubType?: BlockSubType): { text: string; image?: string } {
    if (!kramdown) {
        return { text: "" };
    }

    const lines = kramdown.split("\n").map((line) => line.trim());
    const firstLine = lines.find((line) => line.length > 0) || "";
    const image = extractImageUrl(kramdown);

    let text = firstLine;

    // 移除思源 IAL 属性块（例如 {: id="xxx" updated="xxx"}）
    text = text.replace(/\{:[^}]*\}/g, "").trim();

    // 移除标题标记（# 前缀）
    text = text.replace(/^#{1,6}\s+/, "");

    if (blockSubType?.startsWith("h")) {
        text = text.replace(/^#+\s*/, "");
    } else if (/^(?:[-*+]|\d+\.)\s+/.test(text)) {
        text = text.replace(/^(?:[-*+]|\d+\.)\s+/, "");
    } else if (text.startsWith(">")) {
        text = text.replace(/^>\s*/, "");
    }

    text = cleanMarkdownText(text, true);

    if (!text && blockSubType === "code") {
        text = "代码块";
    }

    if (!text && image) {
        text = "图片";
    }

    return { text: text || "空白块", image };
}

function getHeadingLevel(subtype?: BlockSubType): number | null {
    if (!subtype) return null;
    if (subtype.startsWith("h")) {
        const n = parseInt(subtype.slice(1), 10);
        return isNaN(n) ? null : n;
    }
    return null;
}

function getHeadingLevelFromKramdown(kramdown?: string): number | null {
    if (!kramdown) return null;
    const lines = kramdown.split("\n").map((l) => l.trim());
    const first = lines.find((l) => l.length > 0);
    if (!first) return null;
    const m = first.match(/^(#{1,6})\s+/);
    if (m) {
        return m[1].length;
    }
    return null;
}

interface FlatNode {
    level: number;
    node: MindMapNode;
}

async function collectBlocks(
    blocks: IResGetChildBlock[] | undefined,
    listDepth: number,
    maxHeadingLevel: number,
    visited: Set<string>,
    acc: FlatNode[],
    currentHeadingLevel: number
): Promise<void> {
    if (!blocks || blocks.length === 0) return;

    for (const block of blocks) {
        if (!block || !block.id) continue;
        if (visited.has(block.id)) continue;
        visited.add(block.id);

        // 列表容器仅用于缩进，不作为节点
        if (block.type === "l") {
            const children = await api.getChildBlocks(block.id);
            await collectBlocks(children, listDepth + 1, maxHeadingLevel, visited, acc, currentHeadingLevel);
            continue;
        }

        // 跳过段落块，避免冗余内容
        if (block.type === "p") {
            continue;
        }

        const kramdown = await api.getBlockKramdown(block.id);
        const { text, image } = extractBlockContent(kramdown?.kramdown || "", block.subtype);

        // 如果既没有文本也没有图片，跳过
        if (!text && !image) {
            continue;
        }

        // 计算层级：标题优先，其次列表缩进
        const explicitHeading =
            getHeadingLevel(block.subtype) ?? getHeadingLevelFromKramdown(kramdown?.kramdown);
        let nodeHeadingLevel = currentHeadingLevel;
        let nodeListDepth = listDepth;
        let nodeLevelForTree: number;
        let blockType: BlockType | string | undefined = block.type;
        let blockSubType: BlockSubType | string | undefined = block.subtype;

        if (explicitHeading !== null) {
            nodeHeadingLevel = Math.min(explicitHeading, maxHeadingLevel);
            nodeListDepth = 0;
            blockType = "h";
            blockSubType = `h${nodeHeadingLevel}`;
        } else if (currentHeadingLevel < maxHeadingLevel) {
            // 默认提升为下一级标题
            nodeHeadingLevel = currentHeadingLevel + 1;
            nodeListDepth = 0;
            blockType = "h";
            blockSubType = `h${nodeHeadingLevel}`;
        } else {
            // 已达到最大标题级别，进入列表层级
            blockType = "i";
            blockSubType = "list";
            nodeListDepth = listDepth;
        }

        if (blockType === "h" && nodeHeadingLevel !== null) {
            nodeLevelForTree = nodeHeadingLevel - 1;
        } else {
            // 列表与其他块排在标题之后
            nodeLevelForTree = maxHeadingLevel + nodeListDepth;
        }

        const node: MindMapNode = {
            data: {
                text: text || block.id,
                uid: block.id,
                id: block.id,
                blockId: block.id,
                blockType: blockType as any,
                blockSubType: blockSubType as any,
                richText: false,
            },
            children: [],
        };

        if (image) {
            node.data.image = image;
            node.data.imageSize = { width: 300, height: 300, custom: false };
        }

        acc.push({ level: nodeLevelForTree, node });

        // 递归处理子块
        const children = await api.getChildBlocks(block.id);
        const nextHeadingLevel = blockType === "h" && nodeHeadingLevel !== null ? nodeHeadingLevel : currentHeadingLevel;
        const nextListDepth = blockType === "i" ? nodeListDepth + 1 : 0;
        await collectBlocks(children, nextListDepth, maxHeadingLevel, visited, acc, nextHeadingLevel);
    }
}

function buildTreeFromFlat(root: MindMapNode, flatNodes: FlatNode[]): MindMapNode {
    const stack: Array<{ level: number; node: MindMapNode }> = [{ level: -1, node: root }];

    for (const { level, node } of flatNodes) {
        while (stack.length > 0 && level <= stack[stack.length - 1].level) {
            stack.pop();
        }
        const parent = stack[stack.length - 1].node;
        if (!parent.children) parent.children = [];
        parent.children.push(node);
        stack.push({ level, node });
    }

    return root;
}

export async function parseDocumentBlocksToMindMap(
    docId: string,
    docTitle: string,
    maxHeadingLevel: number = 6
): Promise<MindMapNode> {
    try {
        const rootChildren = await api.getChildBlocks(docId);
        const visited = new Set<string>([docId]);

        const flatNodes: FlatNode[] = [];
        await collectBlocks(rootChildren, 0, maxHeadingLevel, visited, flatNodes, 0);

        const rootNode: MindMapNode = {
            data: {
                text: docTitle,
                uid: docId,
                id: docId,
                blockId: docId,
                blockType: "d",
                richText: false,
            },
            children: [],
        };

        const tree = buildTreeFromFlat(rootNode, flatNodes);
        await updateImageSizes(tree);
        return tree;
    } catch (error) {
        console.error("解析文档失败:", error);
        return {
            data: {
                text: docTitle,
                uid: docId,
                blockId: docId,
                blockType: "d",
            },
            children: [
                {
                    data: {
                        text: "解析失败: " + (error as Error).message,
                        uid: "error-hint",
                    },
                },
            ],
        };
    }
}
