const TENANT_CODE = import.meta.env.VITE_TENANT_CODE as string
const UPLOAD_URL = import.meta.env.VITE_ASSET_UPLOAD_URL as string

export interface AssetUploadResult {
  url: string
  key: string
  contentType: string
  sizeBytes: number
  fileName: string
  tenantCode: string
}

interface ApiEnvelope<T> {
  st: boolean
  msg: string | null
  data: T | null
}

// Uploads a single file to the asset service. The endpoint expects a multipart
// form with `file` and `folder` parts plus the tenant header; never set
// Content-Type manually — the browser must add the multipart boundary.
//
// `folder` lets callers organize uploads server-side (e.g., "chat", "tasks",
// "projects"). Defaults to "any" to keep existing callers working unchanged.
export async function uploadAsset(file: File, folder: string = 'any'): Promise<AssetUploadResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('folder', folder)

  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      accept: '*/*',
      x_tenant_code: TENANT_CODE,
    },
    body: formData,
  })

  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`)

  const json = (await res.json()) as ApiEnvelope<AssetUploadResult>
  if (!json.st || !json.data) throw new Error(json.msg || 'Upload failed')
  return json.data
}
