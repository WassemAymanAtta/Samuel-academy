import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/lib/config';

function assertDemoSeedTarget() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the destructive demo seed in production.');
  }
  if (process.env.ALLOW_DEMO_SEED !== '1') {
    throw new Error('Refusing to wipe data. Set ALLOW_DEMO_SEED=1 to confirm you want to reset demo data.');
  }

  let databaseName = '';
  try {
    databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_URL is invalid; refusing to run the demo seed.');
  }
  if (!['samuel_academy', 'samuel_academy_test'].includes(databaseName)) {
    throw new Error(`Refusing to seed database "${databaseName}". Only samuel_academy / samuel_academy_test are allowed.`);
  }
}

async function main() {
  assertDemoSeedTarget();
  console.log('Resetting Samuel Academy DEMO data (destructive)...');

  // Demo seed is intentionally destructive so it can be run repeatedly.
  await prisma.examAttempt.deleteMany();
  await prisma.lessonProgress.deleteMany();
  await prisma.accessGrant.deleteMany();
  await prisma.paymentRequest.deleteMany();
  await prisma.answerOption.deleteMany();
  await prisma.question.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.product.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.course.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.fileAsset.deleteMany();
  await prisma.user.deleteMany();

  const [adminHash, studentHash, secondStudentHash, pendingHash, rejectedHash] = await Promise.all([
    bcrypt.hash(config.admin.password, 12),
    bcrypt.hash('Student@12345', 12),
    bcrypt.hash('Demo@12345', 12),
    bcrypt.hash('Pending@12345', 12),
    bcrypt.hash('Rejected@12345', 12),
  ]);

  const admin = await prisma.user.create({
    data: {
      name: 'أحمد مدير صموئيل أكاديمي',
      email: config.admin.email,
      passwordHash: adminHash,
      role: 'ADMIN',
      phone: '01000000001',
    },
  });

  const student = await prisma.user.create({
    data: {
      name: 'مريم الطالبة',
      email: 'student@samuelacademy.com',
      passwordHash: studentHash,
      role: 'STUDENT',
      phone: '01000000002',
    },
  });

  await prisma.user.create({
    data: {
      name: 'يوسف متعلم',
      email: 'demo@samuelacademy.com',
      passwordHash: secondStudentHash,
      role: 'STUDENT',
    },
  });

  await prisma.user.create({
    data: {
      name: 'طالبة بانتظار الموافقة',
      email: 'pending@samuelacademy.com',
      passwordHash: pendingHash,
      role: 'STUDENT',
      status: 'PENDING',
      phone: '01000000003',
    },
  });

  await prisma.user.create({
    data: {
      name: 'طالب مرفوض (تجريبي)',
      email: 'rejected@samuelacademy.com',
      passwordHash: rejectedHash,
      role: 'STUDENT',
      status: 'REJECTED',
      phone: '01000000004',
    },
  });

  const programming = await prisma.subject.create({
    data: {
      name: 'البرمجة وتقنية المعلومات',
      slug: 'programming',
      description: 'مسارات عملية في البرمجة تبدأ من الصفر وتنتهي بمشاريع تطبيقية.',
      icon: '</>',
      sortOrder: 1,
    },
  });

  const jsCourse = await prisma.course.create({
    data: {
      subjectId: programming.id,
      title: 'أساسيات JavaScript',
      slug: 'javascript-fundamentals',
      description: 'تعلم أساسيات لغة الويب مع أمثلة عملية وتطبيقات تفاعلية.',
      level: 'مبتدئ',
      sortOrder: 1,
    },
  });

  const pythonCourse = await prisma.course.create({
    data: {
      subjectId: programming.id,
      title: 'Python للمبتدئين',
      slug: 'python-for-beginners',
      description: 'ابدأ رحلتك مع بايثون وابنِ أدواتك الأولى خطوة بخطوة.',
      level: 'مبتدئ',
      sortOrder: 2,
    },
  });

  async function buildUnits(
    courseId: string,
    units: Array<{ title: string; description: string; lessons: Array<{ title: string; description: string; videoUrl: string; pdfUrl: string; duration: number }> }>,
  ) {
    const created: Array<{ id: string; lessons: Array<{ id: string }> }> = [];
    for (let u = 0; u < units.length; u++) {
      const unit = await prisma.unit.create({
        data: {
          courseId,
          title: units[u].title,
          description: units[u].description,
          sortOrder: u + 1,
          lessons: {
            create: units[u].lessons.map((lesson, index) => ({
              title: lesson.title,
              description: lesson.description,
              videoUrl: lesson.videoUrl,
              pdfUrl: lesson.pdfUrl,
              pdfTitle: `ملف الدرس ${index + 1} (PDF)`,
              durationMinutes: lesson.duration,
              sortOrder: index + 1,
              isPublished: true,
            })),
          },
        },
        include: { lessons: { select: { id: true } } },
      });
      created.push({ id: unit.id, lessons: unit.lessons });
    }
    return created;
  }

  const pdf1 = 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf';
  const pdf2 = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

  const jsUnits = await buildUnits(jsCourse.id, [
    {
      title: 'الوحدة الأولى: مقدمة في JavaScript',
      description: 'ما اللغة، كيف نكتبها، وأين تعمل؟',
      lessons: [
        {
          title: 'ما هي JavaScript؟',
          description: 'نظرة عامة على اللغة ومكانها في الويب الحديث.',
          videoUrl: 'https://www.youtube.com/watch?v=W6NZfCO5SIk',
          pdfUrl: pdf1,
          duration: 18,
        },
        {
          title: 'المتغيرات والأنواع',
          description: 'let و const والأنواع الأساسية مع أمثلة.',
          videoUrl: 'https://www.youtube.com/watch?v=DHjqpvDnNGE',
          pdfUrl: pdf2,
          duration: 24,
        },
        {
          title: 'الدوال والشروط',
          description: 'كتابة الدوال واتخاذ القرارات داخل البرنامج.',
          videoUrl: 'https://www.youtube.com/watch?v=Er7lqyU69s0',
          pdfUrl: pdf1,
          duration: 27,
        },
      ],
    },
    {
      title: 'الوحدة الثانية: العمل مع DOM',
      description: 'التعامل مع عناصر الصفحة وربط الأحداث.',
      lessons: [
        {
          title: 'اختيار العناصر',
          description: 'querySelector و getElementById عملياً.',
          videoUrl: 'https://www.youtube.com/watch?v=0ik6X4DJKc4',
          pdfUrl: pdf2,
          duration: 21,
        },
        {
          title: 'تعديل المحتوى والأنماط',
          description: 'تحديث النصوص والفئات ديناميكياً.',
          videoUrl: 'https://www.youtube.com/watch?v=GfODpFSrQXQ',
          pdfUrl: pdf1,
          duration: 25,
        },
        {
          title: 'أحداث النقر والإدخال',
          description: 'بناء نموذج تفاعلي بسيط.',
          videoUrl: 'https://www.youtube.com/watch?v=1ZTNk1CcgCw',
          pdfUrl: pdf2,
          duration: 29,
        },
      ],
    },
  ]);

  const pyUnits = await buildUnits(pythonCourse.id, [
    {
      title: 'الوحدة الأولى: أساسيات بايثون',
      description: 'تثبيت اللغة وكتابة أول برنامج.',
      lessons: [
        {
          title: 'تجهيز بيئة العمل',
          description: 'تثبيت Python وفتح المحرر المناسب.',
          videoUrl: 'https://www.youtube.com/watch?v=_uQrJ0TkZlc',
          pdfUrl: pdf2,
          duration: 16,
        },
        {
          title: 'الأرقام والنصوص',
          description: 'الأنواع الأساسية والعمليات الحسابية.',
          videoUrl: 'https://www.youtube.com/watch?v=khKv-8q7YmI',
          pdfUrl: pdf1,
          duration: 22,
        },
        {
          title: 'القوائم والحلقات',
          description: 'تخزين البيانات والتكرار.',
          videoUrl: 'https://www.youtube.com/watch?v=6f_3YjR8T7o',
          pdfUrl: pdf2,
          duration: 26,
        },
      ],
    },
    {
      title: 'الوحدة الثانية: برمجة عملية',
      description: 'دوال وملفات ومشروع صغير.',
      lessons: [
        {
          title: 'تعريف الدوال',
          description: 'تنظيم الكود داخل دوال قابلة لإعادة الاستخدام.',
          videoUrl: 'https://www.youtube.com/watch?v=Z1PCtIfAi-Q',
          pdfUrl: pdf1,
          duration: 20,
        },
        {
          title: 'قراءة وكتابة الملفات',
          description: 'التعامل مع ملفات النصوص.',
          videoUrl: 'https://www.youtube.com/watch?v=Uh2vVnYqb0I',
          pdfUrl: pdf2,
          duration: 23,
        },
        {
          title: 'مشروع: دفتر ملاحظات',
          description: 'تطبيق بسيط يجمع ما تعلمناه.',
          videoUrl: 'https://www.youtube.com/watch?v=8hly31xKli0',
          pdfUrl: pdf1,
          duration: 35,
        },
      ],
    },
  ]);

  async function createExam(input: {
    title: string;
    description: string;
    unitId: string;
    passingScore: number;
    questions: Array<{
      type: 'MCQ' | 'TRUE_FALSE' | 'MULTIPLE_SELECT' | 'SHORT_ANSWER';
      prompt: string;
      points: number;
      explanation: string;
      expectedAnswer?: string;
      options?: Array<{ text: string; isCorrect: boolean }>;
    }>;
  }) {
    return prisma.exam.create({
      data: {
        unitId: input.unitId,
        title: input.title,
        description: input.description,
        passingScore: input.passingScore,
        isPublished: true,
        questions: {
          create: input.questions.map((q, qi) => ({
            type: q.type,
            prompt: q.prompt,
            points: q.points,
            explanation: q.explanation,
            expectedAnswer: q.expectedAnswer,
            sortOrder: qi + 1,
            options: {
              create: (q.options ?? []).map((o, oi) => ({ text: o.text, isCorrect: o.isCorrect, sortOrder: oi + 1 })),
            },
          })),
        },
      },
    });
  }

  const jsExam = await createExam({
    title: 'اختبار الوحدة الأولى - JavaScript',
    description: 'اختبار قصير يقيس فهم المفاهيم الأساسية.',
    unitId: jsUnits[0].id,
    passingScore: 50,
    questions: [
      {
        type: 'MCQ',
        prompt: 'أي كلمة تستخدم لإعلان متغير لا يمكن إعادة تعيينه؟',
        points: 2,
        explanation: 'const تمنع إعادة تعيين المتغير بعد الإعلان عنه.',
        options: [
          { text: 'var', isCorrect: false },
          { text: 'let', isCorrect: false },
          { text: 'const', isCorrect: true },
          { text: 'function', isCorrect: false },
        ],
      },
      {
        type: 'TRUE_FALSE',
        prompt: 'JavaScript لغة تُستخدم في المتصفح فقط.',
        points: 1,
        explanation: 'يمكن تشغيلها أيضاً على الخادم باستخدام Node.js.',
        options: [
          { text: 'صحيح', isCorrect: false },
          { text: 'خطأ', isCorrect: true },
        ],
      },
      {
        type: 'MULTIPLE_SELECT',
        prompt: 'اختر الأنواع التي تدعمها JavaScript:',
        points: 2,
        explanation: 'من الأنواع الأساسية: number و string و boolean.',
        options: [
          { text: 'number', isCorrect: true },
          { text: 'string', isCorrect: true },
          { text: 'boolean', isCorrect: true },
          { text: 'painting', isCorrect: false },
        ],
      },
      {
        type: 'SHORT_ANSWER',
        prompt: 'ما اسم الدالة التي تُخرج قيمة إلى وحدة التحكم؟',
        points: 1,
        explanation: 'console.log هو الأكثر استخداماً للطبع في وحدة التحكم.',
        expectedAnswer: 'console.log',
      },
    ],
  });

  await createExam({
    title: 'اختبار الوحدة الأولى - Python',
    description: 'أسئلة متنوعة في أساسيات بايثون.',
    unitId: pyUnits[0].id,
    passingScore: 60,
    questions: [
      {
        type: 'MCQ',
        prompt: 'ما نوع القيمة 42 في بايثون؟',
        points: 1,
        explanation: '42 عدد صحيح من نوع int.',
        options: [
          { text: 'str', isCorrect: false },
          { text: 'int', isCorrect: true },
          { text: 'list', isCorrect: false },
          { text: 'dict', isCorrect: false },
        ],
      },
      {
        type: 'TRUE_FALSE',
        prompt: 'تُستخدم الأقواس المربعة لإنشاء قائمة في بايثون.',
        points: 1,
        explanation: 'مثال: my_list = [1, 2, 3].',
        options: [
          { text: 'صحيح', isCorrect: true },
          { text: 'خطأ', isCorrect: false },
        ],
      },
      {
        type: 'SHORT_ANSWER',
        prompt: 'اكتب الكلمة المفتاحية التي تعرف دالة في بايثون.',
        points: 1,
        explanation: 'تُعرّف الدوال باستخدام def.',
        expectedAnswer: 'def',
      },
    ],
  });

  const monthlyAll = await prisma.product.create({
    data: {
      name: 'اشتراك شهري - كل المواد',
      description: 'وصول غير محدود لجميع الكورسات لمدة 30 يوماً.',
      type: 'MONTHLY',
      priceCents: 49900,
      durationDays: 30,
      isActive: true,
    },
  });

  const termAll = await prisma.product.create({
    data: {
      name: 'اشتراك الفصل الدراسي',
      description: 'وصول كامل لمدة أربعة أشهر.',
      type: 'TERM',
      priceCents: 119900,
      durationDays: 120,
      isActive: true,
    },
  });

  const programmingMonthly = await prisma.product.create({
    data: {
      name: 'اشتراك شهري - مسار البرمجة',
      description: 'جميع كورسات البرمجة لمدة 30 يوماً.',
      type: 'MONTHLY',
      priceCents: 29900,
      durationDays: 30,
      subjectId: programming.id,
      isActive: true,
    },
  });

  const jsUnitProduct = await prisma.product.create({
    data: {
      name: 'وحدة أساسيات JavaScript',
      description: 'وصول دائم للوحدة الأولى والدروس والاختبار المرتبط بها.',
      type: 'UNIT',
      priceCents: 9900,
      unitId: jsUnits[0].id,
      isActive: true,
    },
  });

  const pythonUnitProduct = await prisma.product.create({
    data: {
      name: 'وحدة أساسيات بايثون',
      description: 'وصول دائم لوحدة أساسيات بايثون.',
      type: 'UNIT',
      priceCents: 9900,
      unitId: pyUnits[0].id,
      isActive: true,
    },
  });

  await prisma.product.create({
    data: {
      name: 'درس مفرد: ما هي JavaScript؟',
      description: 'شراء درس واحد فقط - متاح بشكل دائم.',
      type: 'LESSON',
      priceCents: 3900,
      lessonId: jsUnits[0].lessons[0].id,
      isActive: true,
    },
  });

  // An approved demo purchase gives the sample student content to explore.
  const approvedPayment = await prisma.paymentRequest.create({
    data: {
      userId: student.id,
      productId: programmingMonthly.id,
      amountCents: programmingMonthly.priceCents,
      method: 'INSTAPAY',
      reference: 'DEMO-APPROVED-2026',
      note: 'اشتراك تجريبي معتمد لعرض لوحة الطالب',
      status: 'APPROVED',
      reviewedById: admin.id,
      reviewedAt: new Date(),
    },
  });

  const expiry = new Date();
  expiry.setDate(expiry.getDate() + programmingMonthly.durationDays!);
  await prisma.accessGrant.create({
    data: {
      userId: student.id,
      productId: programmingMonthly.id,
      paymentRequestId: approvedPayment.id,
      expiresAt: expiry,
    },
  });

  await prisma.lessonProgress.create({
    data: { userId: student.id, lessonId: jsUnits[0].lessons[0].id },
  });

  const jsQuestions = await prisma.question.findMany({
    where: { examId: jsExam.id },
    include: { options: true },
    orderBy: { sortOrder: 'asc' },
  });
  const answers: Record<string, string> = {};
  for (const question of jsQuestions) {
    if (question.type === 'SHORT_ANSWER') answers[question.id] = question.expectedAnswer!;
    else answers[question.id] = question.options.find((o) => o.isCorrect)!.id;
  }
  await prisma.examAttempt.create({
    data: {
      examId: jsExam.id,
      userId: student.id,
      answers: answers as never,
      score: 6,
      maxScore: 6,
      passed: true,
      feedback: [] as never,
      submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 26),
    },
  });

  // A pending request for the admin to review.
  await prisma.paymentRequest.create({
    data: {
      userId: student.id,
      productId: jsUnitProduct.id,
      amountCents: jsUnitProduct.priceCents,
      method: 'EWALLET',
      reference: 'DEMO-EWALLET-1001',
      note: 'تحويل تجريبي - يرجى المراجعة',
      status: 'PENDING',
    },
  });

  await prisma.paymentRequest.create({
    data: {
      userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'demo@samuelacademy.com' } })).id,
      productId: pythonUnitProduct.id,
      amountCents: pythonUnitProduct.priceCents,
      method: 'INSTAPAY',
      reference: 'DEMO-INSTAPAY-2044',
      note: 'طلب تجريبي ثانٍ',
      status: 'PENDING',
    },
  });

  await prisma.paymentRequest.create({
    data: {
      userId: student.id,
      productId: termAll.id,
      amountCents: termAll.priceCents,
      method: 'INSTAPAY',
      reference: 'DEMO-INSTAPAY-3001',
      status: 'REJECTED',
      adminNote: 'رقم العملية غير مطابق لتحويل تجريبي سابق.',
      reviewedById: admin.id,
      reviewedAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
    },
  });

  console.log('Demo seed complete.');
  console.log(`Admin: ${config.admin.email} / ${config.admin.password}`);
  console.log('Student: student@samuelacademy.com / Student@12345');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
