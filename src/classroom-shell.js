'use strict';

window.addEventListener('studygate:toolbar-action', async (event) => {
  const actionId = event && event.detail ? event.detail.actionId : '';

  if (actionId === 'student-plan') {
    await window.studyGate.navigate('internal:student-plan');
    return;
  }

  if (actionId === 'refresh-classroom') {
    await window.studyGate.refreshCurrentClassroom();
  }
});
