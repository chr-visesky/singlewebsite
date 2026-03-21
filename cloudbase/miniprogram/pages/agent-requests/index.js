const {
  callAdmin,
  decorateAgentPlanRequests,
  formatCloudTimestamp
} = require('../../utils/studygate-admin');

let identityRequestSerial = 0;
let requestsRequestSerial = 0;
let requestsMutationSerial = 0;

Page({
  data: {
    authorized: false,
    identityHint: '当前账号还不是管理员。',
    requests: [],
    hasRequests: false,
    updatedAtDisplay: '还没有智能体变更申请。',
    pendingCount: 0
  },

  onShow() {
    void this.boot();
  },

  async onPullDownRefresh() {
    await this.boot();
    wx.stopPullDownRefresh();
  },

  async boot() {
    await this.refreshIdentity();

    if (this.data.authorized) {
      await this.reloadRequests();
      return;
    }

    this.setData({
      requests: [],
      hasRequests: false,
      updatedAtDisplay: '还没有智能体变更申请。',
      pendingCount: 0
    });
  },

  async refreshIdentity() {
    const requestSerial = ++identityRequestSerial;

    try {
      const result = await callAdmin('whoami');

      if (requestSerial !== identityRequestSerial) {
        return;
      }

      this.setData({
        authorized: Boolean(result.authorized),
        identityHint: result.authorized
          ? '纯新增会自动生效；修改或删除会在这里等你确认。'
          : '当前账号还不是管理员。'
      });
    } catch (error) {
      if (requestSerial !== identityRequestSerial) {
        return;
      }

      this.setData({
        authorized: false,
        identityHint: '身份获取失败，请刷新重试。'
      });

      wx.showToast({
        title: error && error.message ? error.message : '身份获取失败',
        icon: 'none'
      });
    }
  },

  async reloadRequests() {
    const requestSerial = ++requestsRequestSerial;
    const mutationSerialAtStart = requestsMutationSerial;

    try {
      const result = await callAdmin('listAgentPlanRequests');

      if (requestSerial !== requestsRequestSerial || mutationSerialAtStart !== requestsMutationSerial) {
        return;
      }

      const requests = decorateAgentPlanRequests(result.items);

      this.setData({
        requests,
        hasRequests: requests.length > 0,
        pendingCount: requests.filter((item) => item.status === 'pending').length,
        updatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有智能体变更申请。'
        })
      });
    } catch (error) {
      if (requestSerial !== requestsRequestSerial) {
        return;
      }

      wx.showToast({
        title: error && error.message ? error.message : '加载失败',
        icon: 'none'
      });
    }
  },

  async manualRefresh() {
    await this.boot();
  },

  async approveRequest(event) {
    const requestId = event.currentTarget.dataset.requestid;

    if (!requestId) {
      return;
    }

    try {
      const mutationSerial = ++requestsMutationSerial;
      const result = await callAdmin('approveAgentPlanRequest', {
        requestId
      });

      if (mutationSerial !== requestsMutationSerial) {
        return;
      }

      const requests = decorateAgentPlanRequests(result.items);

      this.setData({
        requests,
        hasRequests: requests.length > 0,
        pendingCount: requests.filter((item) => item.status === 'pending').length,
        updatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有智能体变更申请。'
        })
      });

      wx.showToast({
        title: '已批准并生效',
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '批准失败',
        icon: 'none'
      });
    }
  },

  async rejectRequest(event) {
    const requestId = event.currentTarget.dataset.requestid;
    const label = event.currentTarget.dataset.label || '智能体';

    if (!requestId) {
      return;
    }

    const modalResult = await wx.showModal({
      title: '驳回智能体申请',
      content: `确认驳回这次计划变更吗？\n${label}`,
      confirmColor: '#a62020'
    });

    if (!modalResult.confirm) {
      return;
    }

    try {
      const mutationSerial = ++requestsMutationSerial;
      const result = await callAdmin('rejectAgentPlanRequest', {
        requestId
      });

      if (mutationSerial !== requestsMutationSerial) {
        return;
      }

      const requests = decorateAgentPlanRequests(result.items);

      this.setData({
        requests,
        hasRequests: requests.length > 0,
        pendingCount: requests.filter((item) => item.status === 'pending').length,
        updatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近更新：',
          emptyText: '还没有智能体变更申请。'
        })
      });

      wx.showToast({
        title: '已驳回',
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '驳回失败',
        icon: 'none'
      });
    }
  }
});
