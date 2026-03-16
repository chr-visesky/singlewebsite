const {
  callAdmin,
  decorateAdmins,
  decorateStudentDevices,
  formatCloudTimestamp
} = require('../../utils/studygate-admin');

let identityRequestSerial = 0;
let adminsRequestSerial = 0;
let adminsMutationSerial = 0;
let devicesRequestSerial = 0;
let devicesMutationSerial = 0;
let controlRequestSerial = 0;
let controlMutationSerial = 0;

Page({
  data: {
    openId: '',
    openIdDisplay: '未获取到',
    authorized: false,
    identityHint: '当前账号还不是管理员。',
    admins: [],
    hasAdmins: false,
    adminUpdatedAtDisplay: '还没有管理员记录。',
    adminDraftOpenId: '',
    studentDevices: [],
    hasStudentDevices: false,
    studentDevicesUpdatedAtDisplay: '还没有桌面客户端申请记录。',
    hasExitPassword: false,
    exitPasswordUpdatedAtDisplay: '未设置',
    exitPasswordDraft: '',
    exitPasswordConfirmDraft: ''
  },

  onShow() {
    void this.boot();
  },

  openLibrariesPage() {
    wx.navigateTo({
      url: '/pages/libraries/index'
    });
  },

  openToolsPage() {
    wx.navigateTo({
      url: '/pages/tools/index'
    });
  },

  openClassroomsPage() {
    wx.navigateTo({
      url: '/pages/classrooms/index'
    });
  },

  async boot() {
    await this.refreshIdentity();

    if (this.data.authorized) {
      await Promise.all([this.reloadAdmins(), this.reloadStudentDevices(), this.reloadControlSettings()]);
      return;
    }

    this.setData({
      admins: [],
      hasAdmins: false,
      adminUpdatedAtDisplay: '还没有管理员记录。',
      studentDevices: [],
      hasStudentDevices: false,
      studentDevicesUpdatedAtDisplay: '还没有桌面客户端申请记录。',
      hasExitPassword: false,
      exitPasswordUpdatedAtDisplay: '未设置'
    });
  },

  formatUpdatedAt(value) {
    return formatCloudTimestamp(value, {
      prefix: '最近更新：',
      emptyText: '未设置'
    });
  },

  async refreshIdentity() {
    const requestSerial = ++identityRequestSerial;

    try {
      const result = await callAdmin('whoami');

      if (requestSerial !== identityRequestSerial) {
        return;
      }

      const identityHint = result.authorized
        ? '当前账号已授权，可以管理管理员名单。'
        : '当前账号还不是管理员。请让现有管理员把这个 OPENID 加进列表。';

      this.setData({
        openId: result.openId || '',
        openIdDisplay: result.openId || '未获取到',
        authorized: Boolean(result.authorized),
        identityHint
      });
    } catch (error) {
      if (requestSerial !== identityRequestSerial) {
        return;
      }

      this.setData({
        openId: '',
        openIdDisplay: '未获取到',
        authorized: false,
        identityHint: '身份获取失败，请刷新重试。',
        admins: [],
        hasAdmins: false
      });

      wx.showToast({
        title: (error && (error.errMsg || error.message)) || '身份获取失败',
        icon: 'none'
      });
    }
  },

  async reloadAdmins() {
    const requestSerial = ++adminsRequestSerial;
    const mutationSerialAtStart = adminsMutationSerial;

    try {
      const result = await callAdmin('listAdmins');

      if (requestSerial !== adminsRequestSerial || mutationSerialAtStart !== adminsMutationSerial) {
        return;
      }

      const admins = decorateAdmins(result.openIds, this.data.openId);

      this.setData({
        admins,
        hasAdmins: admins.length > 0,
        adminUpdatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有管理员记录。'
        })
      });
    } catch (error) {
      if (requestSerial !== adminsRequestSerial) {
        return;
      }

      wx.showToast({
        title: error && error.message ? error.message : '管理员加载失败',
        icon: 'none'
      });
    }
  },

  async reloadStudentDevices() {
    const requestSerial = ++devicesRequestSerial;
    const mutationSerialAtStart = devicesMutationSerial;

    try {
      const result = await callAdmin('listStudentDevices');

      if (requestSerial !== devicesRequestSerial || mutationSerialAtStart !== devicesMutationSerial) {
        return;
      }

      const studentDevices = decorateStudentDevices(result.items);

      this.setData({
        studentDevices,
        hasStudentDevices: studentDevices.length > 0,
        studentDevicesUpdatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有桌面客户端申请记录。'
        })
      });
    } catch (error) {
      if (requestSerial !== devicesRequestSerial) {
        return;
      }

      wx.showToast({
        title: error && error.message ? error.message : '客户端列表加载失败',
        icon: 'none'
      });
    }
  },

  async reloadControlSettings() {
    const requestSerial = ++controlRequestSerial;
    const mutationSerialAtStart = controlMutationSerial;

    try {
      const result = await callAdmin('getControlSettings');

      if (requestSerial !== controlRequestSerial || mutationSerialAtStart !== controlMutationSerial) {
        return;
      }

      this.setData({
        hasExitPassword: Boolean(result.hasExitPassword),
        exitPasswordUpdatedAtDisplay: Boolean(result.hasExitPassword)
          ? this.formatUpdatedAt(result.exitPasswordUpdatedAt)
          : '未设置'
      });
    } catch (error) {
      if (requestSerial !== controlRequestSerial) {
        return;
      }

      wx.showToast({
        title: error && error.message ? error.message : '控制设置加载失败',
        icon: 'none'
      });
    }
  },

  onAdminInput(event) {
    this.setData({
      adminDraftOpenId: event.detail.value
    });
  },

  onExitPasswordInput(event) {
    this.setData({
      exitPasswordDraft: event.detail.value
    });
  },

  onExitPasswordConfirmInput(event) {
    this.setData({
      exitPasswordConfirmDraft: event.detail.value
    });
  },

  copyOpenId() {
    if (!this.data.openId) {
      return;
    }

    wx.setClipboardData({
      data: this.data.openId
    });
  },

  async addAdmin() {
    const openId = (this.data.adminDraftOpenId || '').trim();

    if (!openId) {
      wx.showToast({
        title: '先填要添加的 OPENID',
        icon: 'none'
      });
      return;
    }

    try {
      const mutationSerial = ++adminsMutationSerial;
      const result = await callAdmin('addAdmin', {
        openId
      });

      if (mutationSerial !== adminsMutationSerial) {
        return;
      }

      const admins = decorateAdmins(result.openIds, this.data.openId);

      this.setData({
        admins,
        hasAdmins: admins.length > 0,
        adminUpdatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有管理员记录。'
        }),
        adminDraftOpenId: ''
      });

      wx.showToast({
        title: '管理员已添加',
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '添加失败',
        icon: 'none'
      });
    }
  },

  async saveExitPassword() {
    const password = this.data.exitPasswordDraft || '';
    const confirmPassword = this.data.exitPasswordConfirmDraft || '';

    if (password.trim().length < 4) {
      wx.showToast({
        title: '密码至少 4 位',
        icon: 'none'
      });
      return;
    }

    if (password !== confirmPassword) {
      wx.showToast({
        title: '两次密码不一致',
        icon: 'none'
      });
      return;
    }

    try {
      const mutationSerial = ++controlMutationSerial;
      const result = await callAdmin('saveControlSettings', {
        exitPassword: password
      });

      if (mutationSerial !== controlMutationSerial) {
        return;
      }

      this.setData({
        hasExitPassword: Boolean(result.hasExitPassword),
        exitPasswordUpdatedAtDisplay: Boolean(result.hasExitPassword)
          ? this.formatUpdatedAt(result.exitPasswordUpdatedAt)
          : '未设置',
        exitPasswordDraft: '',
        exitPasswordConfirmDraft: ''
      });

      wx.showToast({
        title: '退出密码已保存',
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '保存失败',
        icon: 'none'
      });
    }
  },

  async clearExitPassword() {
    const modalResult = await wx.showModal({
      title: '清空退出密码',
      content: '确认清空客户端退出密码吗？',
      confirmColor: '#a62020'
    });

    if (!modalResult.confirm) {
      return;
    }

    try {
      const mutationSerial = ++controlMutationSerial;
      const result = await callAdmin('saveControlSettings', {
        clearExitPassword: true
      });

      if (mutationSerial !== controlMutationSerial) {
        return;
      }

      this.setData({
        hasExitPassword: Boolean(result.hasExitPassword),
        exitPasswordUpdatedAtDisplay: '未设置',
        exitPasswordDraft: '',
        exitPasswordConfirmDraft: ''
      });

      wx.showToast({
        title: '退出密码已清空',
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '清空失败',
        icon: 'none'
      });
    }
  },

  async approveStudentDevice(event) {
    const deviceId = event.currentTarget.dataset.deviceid;

    if (!deviceId) {
      return;
    }

    try {
      const mutationSerial = ++devicesMutationSerial;
      const result = await callAdmin('approveStudentDevice', {
        deviceId
      });

      if (mutationSerial !== devicesMutationSerial) {
        return;
      }

      const studentDevices = decorateStudentDevices(result.items);

      this.setData({
        studentDevices,
        hasStudentDevices: studentDevices.length > 0,
        studentDevicesUpdatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有桌面客户端申请记录。'
        })
      });

      wx.showToast({
        title: '已批准',
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '批准失败',
        icon: 'none'
      });
    }
  },

  async removeStudentDevice(event) {
    const deviceId = event.currentTarget.dataset.deviceid;
    const label = event.currentTarget.dataset.label || '桌面客户端';

    if (!deviceId) {
      return;
    }

    const modalResult = await wx.showModal({
      title: '删除客户端',
      content: `确认删除这个客户端授权吗？\n${label}`,
      confirmColor: '#a62020'
    });

    if (!modalResult.confirm) {
      return;
    }

    try {
      const mutationSerial = ++devicesMutationSerial;
      const result = await callAdmin('removeStudentDevice', {
        deviceId
      });

      if (mutationSerial !== devicesMutationSerial) {
        return;
      }

      const studentDevices = decorateStudentDevices(result.items);

      this.setData({
        studentDevices,
        hasStudentDevices: studentDevices.length > 0,
        studentDevicesUpdatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有桌面客户端申请记录。'
        })
      });

      wx.showToast({
        title: '已删除',
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '删除失败',
        icon: 'none'
      });
    }
  },

  async removeAdmin(event) {
    const openId = event.currentTarget.dataset.openid;

    if (!openId) {
      return;
    }

    const modalResult = await wx.showModal({
      title: '移除管理员',
      content: `确认移除这个管理员吗？\n${openId}`,
      confirmColor: '#a62020'
    });

    if (!modalResult.confirm) {
      return;
    }

    try {
      const mutationSerial = ++adminsMutationSerial;
      const result = await callAdmin('removeAdmin', {
        openId
      });

      if (mutationSerial !== adminsMutationSerial) {
        return;
      }

      const admins = decorateAdmins(result.openIds, this.data.openId);
      const stillAuthorized = admins.some((item) => item.isSelf);

      this.setData({
        admins,
        hasAdmins: admins.length > 0,
        adminUpdatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有管理员记录。'
        }),
        authorized: stillAuthorized,
        identityHint: stillAuthorized ? '当前账号已授权，可以管理管理员名单。' : '当前账号还不是管理员。请让现有管理员把这个 OPENID 加进列表。'
      });

      wx.showToast({
        title: '管理员已移除',
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '移除失败',
        icon: 'none'
      });
    }
  }
});
