-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "mediaFileId" TEXT,
ADD COLUMN     "mediaTitle" TEXT;

-- CreateIndex
CREATE INDEX "Lesson_mediaFileId_idx" ON "Lesson"("mediaFileId");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
