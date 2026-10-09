/**
 * VTEEN DRIVE - Cầu nối Google Drive 15 GB thật (Google Apps Script)
 *
 * HƯỚNG DẪN CÀI ĐẶT TRONG 1 PHÚT:
 * 1. Đăng nhập tài khoản Google Drive 15 GB của Đại ca -> Mở https://script.google.com
 * 2. Bấm "Dự án mới" (New project) -> Xóa code mặc định, dán toàn bộ code này vào.
 * 3. Bấm Lưu (Ctrl + S) -> Bấm nút màu xanh "Triển khai" (Deploy) góc trên bên phải -> "Tùy chọn triển khai mới" (New deployment).
 * 4. Bấm biểu tượng bánh răng chọn loại: "Ứng dụng web" (Web app):
 *    - Thực thi dưới dạng (Execute as): Tôi (Me)
 *    - Ai có quyền truy cập (Who has access): Bất kỳ ai (Anyone)
 * 5. Bấm "Triển khai" (Deploy) -> Cấp quyền truy cập Google Drive -> Copy đường link Web App (https://script.google.com/macros/s/.../exec)
 * 6. Dán đường link đó vào mục "Kết nối Google Drive (15 GB)" trên vteen.shop/driver/ hoặc trang Admin!
 */

const FOLDER_NAME = 'VTEEN_DRIVE';

function getOrCreateFolder() {
  const f = DriveApp.getFoldersByName(FOLDER_NAME);
  if (f.hasNext()) return f.next();
  const created = DriveApp.createFolder(FOLDER_NAME);
  created.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return created;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'quota';
    const usage = DriveApp.getStorageUsed();
    const limit = DriveApp.getStorageLimit() || (15 * 1024 * 1024 * 1024);
    const folder = getOrCreateFolder();

    if (action === 'list') {
      const files = [];
      const iter = folder.getFiles();
      while (iter.hasNext() && files.length < 200) {
        const file = iter.next();
        files.push({
          drive_id: file.getId(),
          file_name: file.getName(),
          mime_type: file.getMimeType(),
          file_size: file.getSize(),
          created_at: Utilities.formatDate(file.getDateCreated(), 'GMT+7', 'yyyy-MM-dd HH:mm:ss')
        });
      }
      return jsonOut({ status: 'success', usage: usage, limit: limit, folderId: folder.getId(), files: files });
    }

    return jsonOut({ status: 'success', usage: usage, limit: limit, folderId: folder.getId() });
  } catch (err) {
    return jsonOut({ status: 'error', message: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'delete' && body.driveId) {
      DriveApp.getFileById(body.driveId).setTrashed(true);
      return jsonOut({ status: 'success' });
    }

    const folder = getOrCreateFolder();
    const name = String(body.fileName || ('vteen_' + Date.now())).replace(/[\\/:*?"<>|]/g, '_');
    const mime = String(body.mimeType || 'application/octet-stream');
    const blob = Utilities.newBlob(Utilities.base64Decode(String(body.base64 || '')), mime, name);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return jsonOut({
      status: 'success',
      file: {
        drive_id: file.getId(),
        file_name: file.getName(),
        mime_type: file.getMimeType(),
        file_size: file.getSize(),
        created_at: Utilities.formatDate(file.getDateCreated(), 'GMT+7', 'yyyy-MM-dd HH:mm:ss')
      },
      quota: {
        usage: DriveApp.getStorageUsed(),
        limit: DriveApp.getStorageLimit() || (15 * 1024 * 1024 * 1024)
      }
    });
  } catch (err) {
    return jsonOut({ status: 'error', message: String(err) });
  }
}
