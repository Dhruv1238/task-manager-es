// Shared wizard primitives used by both the org-structure setup wizard and
// the workflow authoring wizard (Phase 2c). The actual component files live
// under src/pages/OrgSetupWizard/components/ for historical reasons; this
// barrel re-exports them so new code can import from a vertical-agnostic path
// without churning the 8+ existing imports in the org wizard.
export { default as WizardShell } from '../../pages/OrgSetupWizard/components/WizardShell'
export { default as AssistantBubble } from '../../pages/OrgSetupWizard/components/AssistantBubble'
export { default as UserBubble } from '../../pages/OrgSetupWizard/components/UserBubble'
export { default as WizardFooter } from '../../pages/OrgSetupWizard/components/WizardFooter'
export { default as ProgressBar } from '../../pages/OrgSetupWizard/components/ProgressBar'
export { default as KiethAI } from '../../pages/OrgSetupWizard/components/KiethAI'
