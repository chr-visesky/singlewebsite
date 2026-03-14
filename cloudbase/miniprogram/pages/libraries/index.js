const { callAdmin, decorateLibraryItems } = require('../../utils/studygate-admin');

const AUTO_REFRESH_INTERVAL_MS = 30000;

let autoRefreshTimer = null;
let librariesRequestSerial = 0;
let librariesMutationSerial = 0;

function emptyForm() {
  return {
    id: '',
    title: '',
    folderPath: ''
  };
}

Page({
  data: {
    libraries: [],
    hasLibraries: false,
    updatedAtDisplay: '还没有模块记录。',
    form: emptyForm(),
    submitText: '添加模块'
  },

  onShow() {
    void this.reloadLibraries();
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  async onPullDownRefresh() {
    await this.reloadLibraries();
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
      void this.reloadLibraries();
    }, AUTO_REFRESH_INTERVAL_MS);
  },

  stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  },

  async manualRefresh() {
    await this.reloadLibraries();
  },

  async reloadLibraries() {
    const requestSerial = ++librariesRequestSerial;
    const mutationSerialAtStart = librariesMutationSerial;

    try {
      const result = await callAdmin('list');

      if (requestSerial !== librariesRequestSerial || mutationSerialAtStart !== librariesMutationSerial) {
        return;
      }

      const libraries = decorateLibraryItems(result.contentLibraries);

      this.setData({
        libraries,
        hasLibraries: libraries.length > 0,
        updatedAtDisplay: result.updatedAt ? `最近更新：${result.updatedAt}` : '还没有模块记录。'
      });
    } catch (error) {
      if (requestSerial !== librariesRequestSerial) {
        return;
      }

      wx.showToast({
        title: error && error.message ? error.message : '加载失败',
        icon: 'none'
      });
    }
  },

  editLibrary(event) {
    const libraryId = event.currentTarget.dataset.id;
    const library = this.data.libraries.find((item) => item.id === libraryId);

    if (!library) {
      return;
    }

    this.setData({
      form: {
        id: library.id,
        title: library.title,
        folderPath: library.folderPath
      },
      submitText: '保存模块'
    });
  },

  async removeLibrary(event) {
    const libraryId = event.currentTarget.dataset.id;
    const nextLibraries = this.data.libraries.filter((item) => item.id !== libraryId);
    await this.persistLibraries(nextLibraries, '已删除');
  },

  async saveLibrary() {
    const title = (this.data.form.title || '').trim();
    const folderPath = (this.data.form.folderPath || '').trim();

    if (!title || !folderPath) {
      wx.showToast({
        title: '名称和目录都要填',
        icon: 'none'
      });
      return;
    }

    const nextLibrary = {
      id: this.data.form.id || '',
      title,
      folderPath
    };

    const nextLibraries = this.data.form.id
      ? this.data.libraries.map((item) => (item.id === this.data.form.id ? nextLibrary : item))
      : [...this.data.libraries, nextLibrary];

    await this.persistLibraries(nextLibraries, this.data.form.id ? '已保存' : '已添加', {
      resetForm: true
    });
  },

  async persistLibraries(libraries, successText, options = {}) {
    const mutationSerial = ++librariesMutationSerial;

    try {
      const result = await callAdmin('saveLibraries', {
        contentLibraries: libraries
      });

      if (mutationSerial !== librariesMutationSerial) {
        return;
      }

      const nextLibraries = decorateLibraryItems(result.contentLibraries);
      const nextState = {
        libraries: nextLibraries,
        hasLibraries: nextLibraries.length > 0,
        updatedAtDisplay: result.updatedAt ? `最近更新：${result.updatedAt}` : '还没有模块记录。'
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
