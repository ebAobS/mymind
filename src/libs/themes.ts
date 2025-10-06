/**
 * 思维导图主题配置
 * 参考 simple-mind-map 的主题结构
 */

// 默认主题（清新绿色）
export const defaultTheme = {
    paddingX: 15,
    paddingY: 5,
    imgMaxWidth: 200,
    imgMaxHeight: 100,
    iconSize: 20,
    lineWidth: 1,
    lineColor: '#549688',
    lineDasharray: 'none',
    lineStyle: 'curve',
    rootLineKeepSameInCurve: true,
    lineRadius: 5,
    generalizationLineWidth: 1,
    generalizationLineColor: '#549688',
    backgroundColor: '#fafafa',
    root: {
        shape: 'rectangle',
        fillColor: '#549688',
        fontFamily: 'Microsoft YaHei, 微软雅黑, Arial',
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
        borderRadius: 5,
    },
    second: {
        shape: 'rectangle',
        marginX: 100,
        marginY: 40,
        fillColor: '#fff',
        fontFamily: 'Microsoft YaHei, 微软雅黑, Arial',
        color: '#565656',
        fontSize: 16,
        borderColor: '#549688',
        borderWidth: 1,
        borderRadius: 5,
    },
    node: {
        shape: 'rectangle',
        marginX: 50,
        marginY: 0,
        fillColor: 'transparent',
        fontFamily: 'Microsoft YaHei, 微软雅黑, Arial',
        color: '#6a6d6c',
        fontSize: 14,
        borderColor: 'transparent',
        borderWidth: 0,
        borderRadius: 5,
    },
    generalization: {
        shape: 'rectangle',
        marginX: 100,
        marginY: 40,
        fillColor: '#fff',
        fontFamily: 'Microsoft YaHei, 微软雅黑, Arial',
        color: '#565656',
        fontSize: 16,
        borderColor: '#549688',
        borderWidth: 1,
        borderRadius: 5,
    }
};

// 深色主题
export const darkTheme = {
    ...defaultTheme,
    lineColor: '#4a9eff',
    backgroundColor: '#1e1e1e',
    root: {
        ...defaultTheme.root,
        fillColor: '#4a9eff',
        color: '#fff',
    },
    second: {
        ...defaultTheme.second,
        fillColor: '#2d2d30',
        color: '#e0e0e0',
        borderColor: '#4a9eff',
    },
    node: {
        ...defaultTheme.node,
        color: '#d4d4d4',
    },
    generalization: {
        ...defaultTheme.generalization,
        fillColor: '#2d2d30',
        color: '#e0e0e0',
        borderColor: '#4a9eff',
    }
};

// 经典主题（蓝色）
export const classicTheme = {
    ...defaultTheme,
    lineColor: '#2a6bff',
    lineStyle: 'straight',
    root: {
        ...defaultTheme.root,
        fillColor: '#2a6bff',
        color: '#fff',
    },
    second: {
        ...defaultTheme.second,
        borderColor: '#2a6bff',
        marginX: 80,
    },
    node: {
        ...defaultTheme.node,
        marginX: 40,
    }
};

// 小清新主题（粉色）
export const freshTheme = {
    ...defaultTheme,
    lineColor: '#ff6b9d',
    backgroundColor: '#fff5f7',
    root: {
        ...defaultTheme.root,
        fillColor: '#ff6b9d',
        color: '#fff',
    },
    second: {
        ...defaultTheme.second,
        borderColor: '#ff6b9d',
        fillColor: '#ffe0ea',
    },
    node: {
        ...defaultTheme.node,
        color: '#666',
    },
    generalization: {
        ...defaultTheme.generalization,
        borderColor: '#ff6b9d',
        fillColor: '#ffe0ea',
    }
};

// 科技感主题（紫色）
export const techTheme = {
    ...defaultTheme,
    lineColor: '#8b5cf6',
    backgroundColor: '#f5f3ff',
    lineStyle: 'curve',
    root: {
        ...defaultTheme.root,
        fillColor: '#8b5cf6',
        color: '#fff',
        borderRadius: 8,
    },
    second: {
        ...defaultTheme.second,
        borderColor: '#8b5cf6',
        fillColor: '#ede9fe',
        borderRadius: 8,
    },
    node: {
        ...defaultTheme.node,
        color: '#4c1d95',
    },
    generalization: {
        ...defaultTheme.generalization,
        borderColor: '#8b5cf6',
        fillColor: '#ede9fe',
    }
};

// 橙色活力主题
export const energyTheme = {
    ...defaultTheme,
    lineColor: '#ff8c00',
    backgroundColor: '#fffaf0',
    root: {
        ...defaultTheme.root,
        fillColor: '#ff8c00',
        color: '#fff',
    },
    second: {
        ...defaultTheme.second,
        borderColor: '#ff8c00',
        fillColor: '#ffe4b5',
    },
    node: {
        ...defaultTheme.node,
        color: '#8b4513',
    },
    generalization: {
        ...defaultTheme.generalization,
        borderColor: '#ff8c00',
        fillColor: '#ffe4b5',
    }
};

// 商务主题（灰蓝）
export const businessTheme = {
    ...defaultTheme,
    lineColor: '#546e7a',
    backgroundColor: '#eceff1',
    lineStyle: 'straight',
    root: {
        ...defaultTheme.root,
        fillColor: '#546e7a',
        color: '#fff',
        borderRadius: 3,
    },
    second: {
        ...defaultTheme.second,
        borderColor: '#546e7a',
        fillColor: '#cfd8dc',
        borderRadius: 3,
    },
    node: {
        ...defaultTheme.node,
        color: '#37474f',
    },
    generalization: {
        ...defaultTheme.generalization,
        borderColor: '#546e7a',
        fillColor: '#cfd8dc',
    }
};

// 简约主题（黑白）
export const minimalTheme = {
    ...defaultTheme,
    lineColor: '#333',
    backgroundColor: '#fff',
    lineStyle: 'straight',
    root: {
        ...defaultTheme.root,
        fillColor: '#333',
        color: '#fff',
        borderRadius: 2,
    },
    second: {
        ...defaultTheme.second,
        borderColor: '#333',
        fillColor: '#f5f5f5',
        borderRadius: 2,
    },
    node: {
        ...defaultTheme.node,
        color: '#333',
        fillColor: 'transparent',
    },
    generalization: {
        ...defaultTheme.generalization,
        borderColor: '#333',
        fillColor: '#f5f5f5',
    }
};

// 海洋主题（青蓝）
export const oceanTheme = {
    ...defaultTheme,
    lineColor: '#00acc1',
    backgroundColor: '#e0f7fa',
    lineStyle: 'curve',
    root: {
        ...defaultTheme.root,
        fillColor: '#00acc1',
        color: '#fff',
    },
    second: {
        ...defaultTheme.second,
        borderColor: '#00acc1',
        fillColor: '#b2ebf2',
    },
    node: {
        ...defaultTheme.node,
        color: '#006064',
    },
    generalization: {
        ...defaultTheme.generalization,
        borderColor: '#00acc1',
        fillColor: '#b2ebf2',
    }
};

// 主题列表
export const themeList = [
    {
        name: '默认',
        value: 'default',
        config: defaultTheme,
        dark: false
    },
    {
        name: '深色',
        value: 'dark',
        config: darkTheme,
        dark: true
    },
    {
        name: '经典蓝',
        value: 'classic',
        config: classicTheme,
        dark: false
    },
    {
        name: '小清新',
        value: 'fresh',
        config: freshTheme,
        dark: false
    },
    {
        name: '科技紫',
        value: 'tech',
        config: techTheme,
        dark: false
    },
    {
        name: '活力橙',
        value: 'energy',
        config: energyTheme,
        dark: false
    },
    {
        name: '商务灰',
        value: 'business',
        config: businessTheme,
        dark: false
    },
    {
        name: '简约黑白',
        value: 'minimal',
        config: minimalTheme,
        dark: false
    },
    {
        name: '海洋蓝',
        value: 'ocean',
        config: oceanTheme,
        dark: false
    }
];

/**
 * 注册所有主题到MindMap
 * @param MindMap MindMap类
 */
export function registerThemes(MindMap: any) {
    themeList.forEach(theme => {
        try {
            MindMap.defineTheme(theme.value, theme.config);
        } catch (e) {
            console.warn(`主题 ${theme.value} 注册失败:`, e);
        }
    });
}

/**
 * 获取主题配置
 * @param themeName 主题名称
 */
export function getThemeConfig(themeName: string) {
    const theme = themeList.find(t => t.value === themeName);
    return theme ? theme.config : defaultTheme;
}

/**
 * 获取主题列表
 */
export function getThemeList() {
    return themeList;
}

