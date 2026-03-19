import { ChaptersService } from "./chapters.service";

describe("ChaptersService review block", () => {
  it("blocks and then restores previous chapter status", async () => {
    const prisma = {
      chapter: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: "chapter-1",
            status: "draft",
            review_block_reason: null,
            review_block_meta: null,
          })
          .mockResolvedValueOnce({
            id: "chapter-1",
            status: "draft",
            review_block_reason: null,
            review_block_meta: null,
          })
          .mockResolvedValueOnce({
            id: "chapter-1",
            status: "blocked_review",
            review_block_reason: "严重时间线冲突",
            review_block_meta: {
              source: "continuity_fail",
              previous_status: "draft",
              blocked_at: "2026-03-11T00:00:00.000Z",
            },
          }),
        update: jest.fn().mockImplementation(({ data }) => ({
          id: "chapter-1",
          ...data,
        })),
      },
    };

    const service = new ChaptersService(prisma as never);
    const blocked = await service.updateReviewBlock("chapter-1", {
      blocked: true,
      reason: "严重时间线冲突",
      source: "continuity_fail",
      details: ["时间线冲突：上一章已离城，本章又在城中"],
    });

    expect(blocked.status).toBe("blocked_review");
    expect(blocked.review_block_reason).toBe("严重时间线冲突");

    const resumed = await service.updateReviewBlock("chapter-1", {
      blocked: false,
    });

    expect(resumed.status).toBe("draft");
    expect(resumed.review_block_reason).toBeNull();
  });

  it("uses short chapter default word target when omitted", async () => {
    const prisma = {
      chapter: {
        create: jest.fn().mockResolvedValue({
          id: "chapter-2",
          chapter_no: 2,
          word_target: 3000,
        }),
      },
    };

    const service = new ChaptersService(prisma as never);
    await service.createChapter("project-1", {
      chapter_no: 2,
      title: "第二章",
      status: "outline",
    });

    expect(prisma.chapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chapter_no: 2,
          word_target: 3000,
        }),
      }),
    );
  });
});
