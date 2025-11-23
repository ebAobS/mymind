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

async function expandListContainer(block: IResGetChildBlock, visited: Set<string>): Promise<MindMapNode[]> {
    const results: MindMapNode[] = [];
    if (!block || !block.id) return results;
    if (visited.has(block.id)) return results;
    visited.add(block.id);

    const listChildren = await api.getChildBlocks(block.id);
    if (!listChildren || listChildren.length === 0) return results;

    const seenIds = new Set<string>();
    for (const child of listChildren) {
        if (!child || !child.id || seenIds.has(child.id)) continue;
        seenIds.add(child.id);

        if (child.type === "l") {
            const nested = await expandListContainer(child, visited);
            results.push(...nested);
            continue;
        }

        const childNode = await buildMindMapNodeFromBlock(child, visited);
        if (childNode) {
            results.push(childNode);
        }
    }

    return results;
}

async function buildMindMapNodeFromBlock(block: IResGetChildBlock, visited: Set<string>): Promise<MindMapNode | null> {
    if (!block || !block.id) return null;

    if (visited.has(block.id)) {
        return null;
    }
    visited.add(block.id);

    const kramdown = await api.getBlockKramdown(block.id);
    const { text, image } = extractBlockContent(kramdown?.kramdown || "", block.subtype);
    const childrenBlocks = await api.getChildBlocks(block.id);

    const node: MindMapNode = {
        data: {
            text: text || block.id,
            uid: block.id,
            id: block.id,
            blockId: block.id,
            blockType: block.type,
            blockSubType: block.subtype,
            richText: false,
        },
        children: [],
    };

    if (image) {
        node.data.image = image;
        node.data.imageSize = { width: 300, height: 300, custom: false };
    }

    if (childrenBlocks && childrenBlocks.length > 0) {
        const isListItem = block.type === "i";
        const childNodes: MindMapNode[] = [];
        const seenChildIds = new Set<string>();
        for (const child of childrenBlocks) {
            if (!child || !child.id || child.id === block.id) continue;
            if (seenChildIds.has(child.id)) continue;
            seenChildIds.add(child.id);

            // 列表项内部的文本段（p）会重复父节点内容，跳过
            if (isListItem && child.type === "p") {
                continue;
            }

            if (child.type === "l") {
                const listChildren = await expandListContainer(child, visited);
                childNodes.push(...listChildren);
                continue;
            }

            const childNode = await buildMindMapNodeFromBlock(child, visited);
            if (childNode) {
                childNodes.push(childNode);
            }
        }
        node.children = childNodes;
    }

    return node;
}

export async function parseDocumentBlocksToMindMap(docId: string, docTitle: string): Promise<MindMapNode> {
    try {
        const rootChildren = await api.getChildBlocks(docId);
        const visited = new Set<string>();
        visited.add(docId);

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

        if (rootChildren && rootChildren.length > 0) {
            const childNodes: MindMapNode[] = [];
            const seenRootIds = new Set<string>();
            for (const block of rootChildren) {
                if (!block || !block.id || visited.has(block.id)) {
                    continue;
                }
                if (seenRootIds.has(block.id)) continue;
                seenRootIds.add(block.id);

                if (block.type === "l") {
                    const listChildren = await expandListContainer(block, visited);
                    childNodes.push(...listChildren);
                    continue;
                }

                const childNode = await buildMindMapNodeFromBlock(block, visited);
                if (childNode) {
                    childNodes.push(childNode);
                }
            }
            rootNode.children = childNodes;
        }

        await updateImageSizes(rootNode);

        return rootNode;
    } catch (error) {
        console.error("??????:", error);
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
                        text: "????: " + (error as Error).message,
                        uid: "error-hint",
                    },
                },
            ],
        };
    }
}
