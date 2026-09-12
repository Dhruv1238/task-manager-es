import { initializeApp } from 'firebase-admin/app'

/**
 * Cloud Functions entry point.
 *
 * This app is otherwise entirely client-side — every write in `src/lib/firestore.ts`
 * runs in the browser under the signed-in user. Functions exist here for one
 * reason: work that another system has to be able to trigger without holding a
 * user session in this project.
 *
 * Only what is exported from this file is deployed.
 */

initializeApp()

export { createProjectFromSales } from './create-project-from-sales'
