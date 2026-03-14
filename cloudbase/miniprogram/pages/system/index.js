const { callAdmin, decorateAdmins } = require('../../utils/studygate-admin');

let identityRequestSerial = 0;
let adminsRequestSerial = 0;
let adminsMutationSerial = 0;

Page({
  data: {
    openId: '',
    openIdDisplay: '未获取到',
    authorized: false,
    identityHint: '当前账号还不是管理员。',
    admins: [],
    hasAdmins: false,
    adminUpdatedAtDisplay: '还没有管理员记录。',
    adminDraftOpenId: ''
  },

  onShow() {
    void this.boot();
  },

  openLibrariesPage() {
    wx.navigateTo({
      url: '/pages/libraries/index'
    });
  },

  async boot() {
    await this.refreshIdentity();

    if (this.data.authorized) {
      await this.reloadAdmins();
      return;
    }

    this.setData({
      admins: [],
      hasAdmins: false,
      adminUpdatedAtDisplay: '还没有管理员记录。'
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
        adminUpdatedAtDisplay: result.updatedAt ? `最近更新：${result.updatedAt}` : '还没有管理员记录。'
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

  onAdminInput(event) {
    this.setData({
      adminDraftOpenId: event.detail.value
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
        adminUpdatedAtDisplay: result.updatedAt ? `最近更新：${result.updatedAt}` : '还没有管理员记录。',
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
        adminUpdatedAtDisplay: result.updatedAt ? `最近更新：${result.updatedAt}` : '还没有管理员记录。',
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
