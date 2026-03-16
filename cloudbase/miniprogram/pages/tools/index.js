const { callAdmin, decorateLearningToolItems, formatCloudTimestamp } = require('../../utils/studygate-admin');

const AUTO_REFRESH_INTERVAL_MS = 30000;

let autoRefreshTimer = null;
let toolsRequestSerial = 0;
let toolsMutationSerial = 0;

function emptyForm() {
  return {
    id: '',
    title: '',
    appPath: ''
  };
}

Page({
  data: {
    tools: [],
    hasTools: false,
    updatedAtDisplay: '还没有模块记录。',
    form: emptyForm(),
    submitText: '添加模块'
  },

  onShow() {
    void this.reloadTools();
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  async onPullDownRefresh() {
    await this.reloadTools();
    wx.stopPullDownRefresh();
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({
      [`form.${field}`]: event.detail.value
    });
  },

  resetForm() {
    this.setData({
      form: emptyForm(),
      submitText: '添加模块'
    });
  },

  startAutoRefresh() {
    if (autoRefreshTimer) {
      return;
    }

    autoRefreshTimer = setInterval(() => {
      void this.reloadTools();
    }, AUTO_REFRESH_INTERVAL_MS);
  },

  stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  },

  async manualRefresh() {
    await this.reloadTools();
  },

  async reloadTools() {
    const requestSerial = ++toolsRequestSerial;
    const mutationSerialAtStart = toolsMutationSerial;

    try {
      const result = await callAdmin('list');

      if (requestSerial !== toolsRequestSerial || mutationSerialAtStart !== toolsMutationSerial) {
        return;
      }

      const tools = decorateLearningToolItems(result.learningTools);

      this.setData({
        tools,
        hasTools: tools.length > 0,
        updatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有模块记录。'
        })
      });
    } catch (error) {
      if (requestSerial !== toolsRequestSerial) {
        return;
      }

      wx.showToast({
        title: error && error.message ? error.message : '加载失败',
        icon: 'none'
      });
    }
  },

  editTool(event) {
    const toolId = event.currentTarget.dataset.id;
    const tool = this.data.tools.find((item) => item.id === toolId);

    if (!tool) {
      return;
    }

    this.setData({
      form: {
        id: tool.id,
        title: tool.title,
        appPath: tool.appPath
      },
      submitText: '保存模块'
    });
  },

  async removeTool(event) {
    const toolId = event.currentTarget.dataset.id;
    const nextTools = this.data.tools.filter((item) => item.id !== toolId);
    await this.persistTools(nextTools, '已删除');
  },

  async saveTool() {
    const title = (this.data.form.title || '').trim();
    const appPath = (this.data.form.appPath || '').trim();

    if (!title || !appPath) {
      wx.showToast({
        title: '名称和程序路径都要填',
        icon: 'none'
      });
      return;
    }

    const existingTool = this.data.form.id
      ? this.data.tools.find((item) => item.id === this.data.form.id) || null
      : null;
    const nextTool = {
      ...(existingTool || {}),
      id: this.data.form.id || '',
      title,
      appPath
    };

    const nextTools = this.data.form.id
      ? this.data.tools.map((item) => (item.id === this.data.form.id ? nextTool : item))
      : [...this.data.tools, nextTool];

    await this.persistTools(nextTools, this.data.form.id ? '已保存' : '已添加', {
      resetForm: true
    });
  },

  async persistTools(tools, successText, options = {}) {
    const mutationSerial = ++toolsMutationSerial;

    try {
      const result = await callAdmin('saveLearningTools', {
        learningTools: tools
      });

      if (mutationSerial !== toolsMutationSerial) {
        return;
      }

      const nextTools = decorateLearningToolItems(result.learningTools);
      const nextState = {
        tools: nextTools,
        hasTools: nextTools.length > 0,
        updatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有模块记录。'
        })
      };

      if (options.resetForm) {
        nextState.form = emptyForm();
        nextState.submitText = '添加模块';
      }

      this.setData(nextState);

      wx.showToast({
        title: successText,
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '保存失败',
        icon: 'none'
      });
    }
  }
});
