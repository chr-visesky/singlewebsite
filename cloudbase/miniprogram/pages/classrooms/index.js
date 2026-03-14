const { callAdmin, decorateClassroomItems, formatCloudTimestamp } = require('../../utils/studygate-admin');

const AUTO_REFRESH_INTERVAL_MS = 30000;

let autoRefreshTimer = null;
let classroomsRequestSerial = 0;
let classroomsMutationSerial = 0;

function emptyForm() {
  return {
    id: '',
    title: '',
    entryUrl: ''
  };
}

Page({
  data: {
    classrooms: [],
    hasClassrooms: false,
    updatedAtDisplay: '还没有模块记录。',
    form: emptyForm(),
    submitText: '添加模块'
  },

  onShow() {
    void this.reloadClassrooms();
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  async onPullDownRefresh() {
    await this.reloadClassrooms();
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
      void this.reloadClassrooms();
    }, AUTO_REFRESH_INTERVAL_MS);
  },

  stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  },

  async manualRefresh() {
    await this.reloadClassrooms();
  },

  async reloadClassrooms() {
    const requestSerial = ++classroomsRequestSerial;
    const mutationSerialAtStart = classroomsMutationSerial;

    try {
      const result = await callAdmin('list');

      if (requestSerial !== classroomsRequestSerial || mutationSerialAtStart !== classroomsMutationSerial) {
        return;
      }

      const classrooms = decorateClassroomItems(result.onlineClassrooms);

      this.setData({
        classrooms,
        hasClassrooms: classrooms.length > 0,
        updatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有模块记录。'
        })
      });
    } catch (error) {
      if (requestSerial !== classroomsRequestSerial) {
        return;
      }

      wx.showToast({
        title: error && error.message ? error.message : '加载失败',
        icon: 'none'
      });
    }
  },

  editClassroom(event) {
    const classroomId = event.currentTarget.dataset.id;
    const classroom = this.data.classrooms.find((item) => item.id === classroomId);

    if (!classroom) {
      return;
    }

    this.setData({
      form: {
        id: classroom.id,
        title: classroom.title,
        entryUrl: classroom.entryUrl
      },
      submitText: '保存模块'
    });
  },

  async removeClassroom(event) {
    const classroomId = event.currentTarget.dataset.id;
    const nextClassrooms = this.data.classrooms.filter((item) => item.id !== classroomId);
    await this.persistClassrooms(nextClassrooms, '已删除');
  },

  async saveClassroom() {
    const title = (this.data.form.title || '').trim();
    const entryUrl = (this.data.form.entryUrl || '').trim();

    if (!title || !entryUrl) {
      wx.showToast({
        title: '名称和网址都要填',
        icon: 'none'
      });
      return;
    }

    const nextClassroom = {
      id: this.data.form.id || '',
      title,
      entryUrl
    };

    const nextClassrooms = this.data.form.id
      ? this.data.classrooms.map((item) => (item.id === this.data.form.id ? nextClassroom : item))
      : [...this.data.classrooms, nextClassroom];

    await this.persistClassrooms(nextClassrooms, this.data.form.id ? '已保存' : '已添加', {
      resetForm: true
    });
  },

  async persistClassrooms(classrooms, successText, options = {}) {
    const mutationSerial = ++classroomsMutationSerial;

    try {
      const result = await callAdmin('saveOnlineClassrooms', {
        onlineClassrooms: classrooms
      });

      if (mutationSerial !== classroomsMutationSerial) {
        return;
      }

      const nextClassrooms = decorateClassroomItems(result.onlineClassrooms);
      const nextState = {
        classrooms: nextClassrooms,
        hasClassrooms: nextClassrooms.length > 0,
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
