import { createContext, useContext } from 'react';
import { defaultNoticeAppearance, type NoticeBody } from '../api/notices';

export const noteFonts = {
  sans: { label: 'Modern · Sans', family: 'Inter, Arial, Tahoma, sans-serif' },
  serif: { label: 'Classic · Serif', family: 'Georgia, "Times New Roman", serif' },
  handwritten: { label: 'Handwritten', family: '"Segoe Print", "Comic Sans MS", cursive' },
  arabic: { label: 'العربية · Arabic', family: 'Tahoma, Arial, sans-serif' },
};
export const notePapers = ['#fff0a6', '#ffe2ba', '#ffdbe7', '#dcf1d4', '#d9effa', '#e8dfff', '#ffffff'];
export function noteDesign(note: Pick<NoticeBody, 'category' | 'appearance'>) {
  const a = { ...defaultNoticeAppearance, ...note.appearance };
  return { ...a, paper: a.paper || ({ urgent: '#ffdbe0', action: '#fff0a6', update: '#d9effa' }[note.category]), family: noteFonts[a.font].family };
}
export function noteTextStyle(note: Pick<NoticeBody, 'category' | 'appearance'>, zoom = 100) {
  const a = noteDesign(note);
  return { fontFamily: a.family, fontSize: a.font_size * zoom / 100, color: a.ink, textAlign: 'start' as const, whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const, lineHeight: 1.65 };
}
export function paperStyle(paper: string) {
  return {
    backgroundColor: paper, backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,.055), transparent 38px, transparent 75%, rgba(255,255,255,.2))',
    border: '1px solid rgba(60,45,20,.1)', borderRadius: '3px 3px 28px 3px', position: 'relative' as const,
    boxShadow: '2px 10px 13px -7px rgba(35,38,25,.34), 0 2px 3px rgba(35,38,25,.08)',
    '&:after': { content: '""', position: 'absolute', pointerEvents: 'none', right: 0, bottom: 0, width: 27, height: 27,
      background: `linear-gradient(135deg, ${paper} 22%, rgba(255,255,255,.82) 48%, rgba(45,40,20,.18) 51%, transparent 55%)`, borderRadius: '0 0 27px 0' },
  };
}

export const arabic: Record<string, string> = {
  'Field Noticeboard': 'لوحة إعلانات الميدان', 'The briefing before the work.': 'التوجيهات قبل بدء العمل.',
  'Board appearance': 'مظهر اللوحة', 'Board colour': 'لون اللوحة', 'Board language': 'لغة اللوحة', 'Zoom in': 'تكبير', 'Zoom out': 'تصغير',
  'Reset zoom': 'إعادة التكبير إلى ١٠٠٪', 'Default arrangement': 'الترتيب الافتراضي', 'View all notices': 'عرض جميع الإعلانات',
  'Personal settings · saved on this device': 'إعدادات شخصية · محفوظة على هذا الجهاز',
  'Drag the handle to arrange notes. Arrow keys work too.': 'اسحب المقبض لترتيب الملاحظات، أو استخدم مفاتيح الأسهم.',
  'Urgent': 'عاجل', 'Action required': 'إجراء مطلوب', 'Field update': 'تحديث ميداني', 'Everyone': 'الجميع',
  'Active notices': 'الإعلانات النشطة', 'History': 'الأرشيف', 'Search notices': 'ابحث في الإعلانات', 'Type': 'النوع', 'All types': 'كل الأنواع',
  'New notice': 'إعلان جديد', 'Close': 'إغلاق', 'Edit notice': 'تعديل الإعلان', 'Acknowledge': 'تمت القراءة', 'Acknowledged': 'تم تأكيد القراءة',
  'Mark action done': 'تأكيد إنجاز المهمة', 'Archive': 'أرشفة', 'Restore': 'استعادة', 'Reopen action': 'إعادة فتح المهمة',
  'Previous': 'السابق', 'Next': 'التالي', 'Pin a field notice': 'أضف إعلاناً ميدانياً', 'Title': 'العنوان', 'Message': 'الرسالة',
  'Notice design': 'تصميم الملاحظة', 'Language': 'اللغة', 'Automatic': 'تلقائي', 'Text direction': 'اتجاه النص',
  'Right to left': 'من اليمين إلى اليسار', 'Left to right': 'من اليسار إلى اليمين', 'Font': 'الخط', 'Font size': 'حجم الخط',
  'Note colour': 'لون الملاحظة', 'Text colour': 'لون النص', 'Marker': 'رمز الملاحظة', 'No marker': 'بدون رمز',
  'Live preview': 'معاينة مباشرة', 'Add an emoji to the message': 'أضف رمزاً تعبيرياً للرسالة',
  'Cancel': 'إلغاء', 'Save changes': 'حفظ التعديلات', 'Publish notice': 'نشر الإعلان', 'Saving…': 'جارٍ الحفظ…',
  'Who should see this?': 'لمن يظهر الإعلان؟', 'Everyone · all field staff': 'الجميع · كل الفرق الميدانية',
  'Action': 'إجراء', 'Update': 'تحديث', 'Read urgent notice': 'اقرأ الإعلان العاجل', 'FIELD ALERT': 'تنبيه ميداني',
  'Use category colour': 'استخدم لون نوع الإعلان', 'Move note earlier': 'نقل الملاحظة للأعلى', 'Move note later': 'نقل الملاحظة للأسفل',
  'Language sets reading direction; it does not translate the message.': 'تحدد اللغة اتجاه القراءة، ولا تترجم محتوى الرسالة.',
  'Low contrast: choose a darker text colour or a lighter note colour for easier reading.': 'التباين منخفض: اختر لون نص أغمق أو خلفية أفتح لتسهيل القراءة.',
  'A clear instruction helps the crew act with confidence.': 'تساعد التعليمات الواضحة الفريق على العمل بثقة.',
  'Link a tower (optional)': 'ربط ببرج (اختياري)', 'Action owner (optional)': 'المسؤول عن المهمة (اختياري)',
  'Due date (optional)': 'تاريخ الاستحقاق (اختياري)', 'Expiry date (optional)': 'تاريخ انتهاء الإعلان (اختياري)',
  'Opens the tower record from the note.': 'يفتح سجل البرج من الملاحظة.',
  'Choose a tower this team is assigned to or has inspected.': 'اختر برجاً مخصصاً لهذا الفريق أو سبق له فحصه.',
  'Without an owner, any recipient can mark the action done.': 'عند عدم تحديد مسؤول، يمكن لأي مستلم تأكيد إنجاز المهمة.',
  'Visible through this date in Oman, then moved to history.': 'يظل الإعلان ظاهراً حتى هذا التاريخ بتوقيت عُمان، ثم ينتقل إلى الأرشيف.',
  'An urgent banner appears for recipients until they acknowledge this notice or it is archived or expires.': 'يظهر تنبيه عاجل للمستلمين حتى تأكيد القراءة أو أرشفة الإعلان أو انتهاء صلاحيته.',
  'Changes to the instruction, audience, dates or marker start a new acknowledgement round. Colour, font and direction changes preserve existing acknowledgements.': 'تتطلب التغييرات في التعليمات أو المستلمين أو التواريخ أو الرمز تأكيد قراءة جديداً. تحتفظ تغييرات اللون والخط والاتجاه بتأكيدات القراءة السابقة.',
  'Completed, expired and archived notices stay here for reference.': 'تبقى الإعلانات المنجزة والمنتهية والمؤرشفة هنا للرجوع إليها.',
  'No notices match these filters.': 'لا توجد إعلانات تطابق هذه الخيارات.', 'No past notices yet.': 'لا توجد إعلانات سابقة بعد.',
  'No active notices. You’re up to date.': 'لا توجد إعلانات نشطة حالياً.', 'Your next field briefing starts here': 'تبدأ توجيهاتك الميدانية التالية هنا',
  'You’re up to date': 'أنت مطّلع على آخر المستجدات', 'Create first notice': 'إنشاء أول إعلان',
  'Pin a clear instruction, an important update, or the next action for your crew.': 'أضف تعليمات واضحة أو تحديثاً مهماً أو المهمة التالية لفريقك.',
  'Important instructions and team actions will be pinned here.': 'ستظهر هنا التعليمات المهمة ومهام الفريق.',
  'Due': 'الاستحقاق', 'Overdue': 'متأخر', 'For': 'إلى', 'All field staff': 'كل الفرق الميدانية',
  'Please read before continuing your work.': 'يرجى القراءة قبل متابعة العمل.',
  'Acknowledgements': 'تأكيدات القراءة', 'Hide acknowledgements': 'إخفاء تأكيدات القراءة',
  'Posted by': 'نشر بواسطة', 'Action owner:': 'المسؤول عن المهمة:', 'Due:': 'الاستحقاق:', 'Visible through:': 'ظاهر حتى:',
  'Close notice': 'إغلاق الإعلان', 'Close noticeboard': 'إغلاق لوحة الإعلانات',
};
export type BoardPreferences = { language: 'en' | 'ar'; board: string; zoom: number; order: number[] };
export const defaults: BoardPreferences = { language: 'en', board: '#f1f5f2', zoom: 100, order: [] };
export const BoardContext = createContext<{ prefs: BoardPreferences; setPrefs: (update: Partial<BoardPreferences>) => void; t: (text: string) => string } | null>(null);
export function useNoticeDesign() {
  const value = useContext(BoardContext);
  if (!value) throw new Error('NoticePreferences is required');
  return value;
}
