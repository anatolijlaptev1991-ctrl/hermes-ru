'use strict';
// СГЕНЕРИРОВАНО scripts/gen-type-blocks.js из песочно-патченого en.ts — НЕ редактировать вручную.

const moaTypeBlock = `moa: {
      title: string
      description: string
      preset: string
      enabled: string
      setDefault: string
      delete: string
      newPreset: string
      addPreset: string
      defaultLabel: string
      referenceN: (n: number) => string
      remove: string
      addReference: string
      aggregator: string
    }`;

const billingTypeBlock = `billing: {
      title: string
      plan: string
      paymentCredits: string
      usage: string
      processingSettlement: string
      creditsAdded: (amount: string) => string
      openPortal: string
      retry: string
      buy: string
      turnOffAutoRefill: string
      turnOff: string
      disable: string
      autoRefillUpdated: string
      autoRefillTurnedOff: string
      threshold: string
      reloadTo: string
      plans: string
      currentPlan: string
      scheduled: string
      downgrade: string
      manage: string
      undo: string
      undoing: string
      confirmDowngrade: string
      checkingChange: string
      blockedChange: string
      alreadyOnPlan: (name: string) => string
      effectScheduled: (targetName: string, effectiveAt: string, creditsDelta: string) => string
      notScheduleable: string
      noPlansAvailable: string
      tryAgain: string
      save: string
      saving: string
      cancel: string
      usageLabel: (label: string) => string
      state: {
        openPortal: string
        openPortalShort: string
        connectMessage: string
        connectTitle: string
        addCard: string
        noPaymentMethod: string
        noCardMessage: string
        addPaymentMethod: string
        paymentMethod: string
        update: string
        manageCardDesc: string
        buy: string
        buyCreditsDesc: string
        buyCreditsNow: string
        autoRefillGeneric: string
        manage: string
        manageAutoRefillCaption: string
        refillWhenLow: string
        turnOnAutoRefillCaption: string
        reconcile: string
        autoRefillCard: string
        customerDefault: string
        subscriptionCard: string
        subscriptionCreditsRemaining: string
        subscriptionCredits: string
        doesNotExpire: string
        topUpCredits: string
        monthlySpendCapUsed: string
        monthlySpendCap: string
        defaultCeiling: string
        monthlyRemoteSpending: string
        changePlan: string
        viewPlans: string
        adjustPlan: string
        choose: string
        enabled: string
        off: string
        subscriptionUnavailable: string
        noActiveSubscription: string
        changesTo: (tierName: string, when: string) => string
        cancelsOn: (when: string) => string
        renews: (renewal: string) => string
        autoRefillReconcile: (cardLabel: string) => string
        autoRefillCharges: (reloadTo: string, threshold: string) => string
        resetsOn: (date: string) => string
        ofUsed: (spent: string, limit: string) => string
        remoteSpendingReconnect: (who: string) => string
      }
      errors: {
        cardConfirmationNeeded: string
        cardConfirmationMessage: string
        remoteSpendingNeedsApproval: string
        remoteSpendingMessage: string
        remoteSpendingStopped: string
        adminStopped: string
        youStopped: string
        sessionLoggedOut: string
        sessionLoggedOutMessage: string
        remoteSpendingOff: string
        remoteSpendingOffMessage: string
        adminRoleRequired: string
        adminRoleRequiredMessage: string
        startFreshTopUp: string
        idempotencyConflictMessage: string
        noSavedCard: string
        noSavedCardMessage: string
        orgAccessDenied: string
        orgAccessDeniedMessage: string
        monthlyCapExceeded: string
        monthlyCapExceededWithRemaining: (remaining: number) => string
        monthlyCapExceededSimple: string
        tooManyCharges: string
        rateLimitedMessage: (mins: string) => string
        stripeTrouble: string
        stripeRetryMessage: (mins: string) => string
        dailyPlanChangeLimit: string
        dailyPlanChangeLimitMessage: string
        endpointUnavailable: string
        endpointUnavailableMessage: string
        requestTimedOut: string
        requestTimedOutMessage: string
        connectionFailed: string
        connectionFailedMessage: string
        requestFailed: string
        requestFailedMessage: string
      }
    }`;

const customEndpointsTypeBlock = `customEndpoints: {
      title: string
      emptyTitle: string
      emptyDescription: string
      editTitle: string
      addTitle: string
      name: string
      providerId: string
      endpointUrl: string
      defaultModel: string
      context: string
      apiKey: string
      useForNewChats: string
      discoverModels: string
      test: string
      save: string
      newEndpoint: string
      active: string
      use: string
      deleteEndpoint: string
      loadError: string
      saveSuccess: string
      saveFailed: string
      validationFailed: string
      activationFailed: string
      deleteFailed: string
      reachable: string
      reachableWithCount: (count: number) => string
      validationFailedEndpoint: string
      deleteConfirm: (name: string) => string
    }`;

module.exports = { moaTypeBlock, billingTypeBlock, customEndpointsTypeBlock };
