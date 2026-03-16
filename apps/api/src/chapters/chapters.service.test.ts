import { NotFoundException } from "@nestjs/common";
import { ChaptersService } from "./chapters.service";

describe("ChaptersService", () => {
  it("returns a chapter by project id and chapter number", async () => {
    const prisma = {
      chapter: {
        findFirst: jest.fn().mockResolvedValue({
          id: "chapter-1",
          project_id: "project-1",
          chapter_no: 2,
        }),
      },
    };
    const service = new ChaptersService(prisma as never);

    await expect(service.getChapterByNo("project-1", 2)).resolves.toEqual({
      id: "chapter-1",
      project_id: "project-1",
      chapter_no: 2,
    });
    expect(prisma.chapter.findFirst).toHaveBeenCalledWith({
      where: {
        project_id: "project-1",
        chapter_no: 2,
      },
    });
  });

  it("throws when the chapter number does not exist", async () => {
    const prisma = {
      chapter: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new ChaptersService(prisma as never);

    await expect(service.getChapterByNo("project-1", 99)).rejects.toBeInstanceOf(NotFoundException);
  });
});
