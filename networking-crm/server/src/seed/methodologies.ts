import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const METHODOLOGIES = [
  {
    source: "Keith Ferrazzi, Never Eat Alone",
    title: "The Follow-Up Within 24 Hours",
    core_principle: "Following up within 24 hours of meeting someone cements the connection and distinguishes you from 99% of people.",
    full_text: "The single most important thing you can do after meeting someone is to follow up within 24 hours. This isn't about being pushy — it's about being memorable. Most people meet dozens of interesting people at events but never follow up. A simple email or message referencing something specific from your conversation shows you were genuinely engaged. Ferrazzi suggests always including a reference to a shared interest or something you discussed, and offering value — an article, introduction, or resource related to what they care about.",
    application_steps: "1. Within 24 hours, send a personalized message\n2. Reference something specific from your conversation\n3. Offer something of value (article, intro, resource)\n4. Suggest a specific next step (coffee, call, event)\n5. Keep it brief — 3-4 sentences max",
    when_to_use: "After meeting someone new at any event, conference, or introduction",
    tags: ["follow-up", "first-meeting", "new-contacts", "timing"],
  },
  {
    source: "Keith Ferrazzi, Never Eat Alone",
    title: "The Generosity Principle",
    core_principle: "Always lead with generosity. The currency of networking is not greed but generosity — give before you ask.",
    full_text: "Ferrazzi's core thesis is that real networking is about helping others first. Before asking for anything, establish yourself as someone who gives. This could be introductions, knowledge, resources, or simply your time and attention. The key insight is that people remember those who helped them without expecting anything in return. This creates a natural reciprocity cycle that's far more powerful than transactional networking.",
    application_steps: "1. Before each meeting, think: what can I offer this person?\n2. Make 2-3 introductions per week for people in your network\n3. Share articles/resources relevant to contacts' interests\n4. When someone asks for help, say yes when possible\n5. Track what you've given — it motivates continued generosity",
    when_to_use: "As a daily practice and in every networking interaction",
    tags: ["generosity", "giving", "mindset", "relationship-building"],
  },
  {
    source: "Adam Grant, Give and Take",
    title: "The Five-Minute Favor",
    core_principle: "Look for ways to help others that take you 5 minutes or less but create significant value for them.",
    full_text: "Adam Grant's research shows that the most successful networkers are 'givers' — but smart givers, not doormats. The Five-Minute Favor is a practical framework: look for high-impact, low-cost ways to help. This might be making an introduction, sharing expertise, providing feedback on someone's work, or forwarding a relevant opportunity. The key is consistency — doing many small favors builds enormous social capital over time without burning you out.",
    application_steps: "1. When talking to someone, actively listen for needs\n2. Ask yourself: can I help in under 5 minutes?\n3. Make introductions between people who should know each other\n4. Share knowledge or expertise freely\n5. Follow through — actually do the favor, don't just promise",
    when_to_use: "In conversations when you notice someone has a need you can easily address",
    tags: ["giving", "favor", "efficiency", "social-capital"],
  },
  {
    source: "Robin Dunbar, Dunbar's Number",
    title: "Dunbar's Layers of Intimacy",
    core_principle: "Humans can maintain ~150 active relationships, organized in layers: 5 intimate, 15 close, 50 friends, 150 acquaintances.",
    full_text: "Robin Dunbar's research revealed that our social brain has limits. We can maintain about 150 active relationships, but these aren't equal. The innermost circle (5 people) gets most of your social energy — these are your support group. The next layer (15) are close friends. Then 50 good friends. Then 150 meaningful contacts. Understanding this helps you invest your networking energy wisely — you can't be equally close to everyone, and that's okay.",
    application_steps: "1. Map your current network into Dunbar's layers\n2. Identify your core 5 and close 15\n3. Focus most energy on strengthening top 50\n4. For contacts 50-150, maintain light but regular touch\n5. Periodically reassess — people move between layers naturally",
    when_to_use: "When planning networking strategy, deciding who to prioritize, feeling overwhelmed by too many contacts",
    tags: ["prioritization", "strategy", "social-science", "capacity"],
  },
  {
    source: "Mark Granovetter, The Strength of Weak Ties",
    title: "Weak Ties Are Your Hidden Asset",
    core_principle: "Acquaintances (weak ties) are often more valuable for opportunities than close friends, because they connect you to different social circles.",
    full_text: "Granovetter's landmark study showed that most people find jobs and opportunities through weak ties — people they see occasionally, not their best friends. This is because your close friends know the same people you do, while acquaintances bridge to entirely different networks. The practical implication: don't neglect your loose connections. That person you met once at a conference might be the one who connects you to your next big opportunity.",
    application_steps: "1. Don't dismiss casual acquaintances — they're bridges\n2. Maintain light contact with diverse connections\n3. When seeking opportunities, reach out to acquaintances first\n4. Attend events outside your usual circle\n5. Be a weak tie for others — introduce people from different worlds",
    when_to_use: "When seeking new opportunities, job searching, exploring new industries or interests",
    tags: ["weak-ties", "opportunities", "diversity", "bridges"],
  },
  {
    source: "Ronald Burt, Structural Holes",
    title: "Bridge the Structural Holes",
    core_principle: "The most valuable position in a network is bridging disconnected groups — being the connector between clusters.",
    full_text: "Burt's research shows that people who bridge 'structural holes' — gaps between otherwise disconnected groups — get more creative ideas, earlier access to information, and better career outcomes. These 'brokers' aren't necessarily the most connected people, but they connect different worlds. If you know both tech people and artists, both investors and academics, you become invaluable as a bridge.",
    application_steps: "1. Map the different groups/clusters in your network\n2. Identify groups that could benefit from knowing each other\n3. Actively make introductions across clusters\n4. Position yourself at the intersection of different worlds\n5. Attend events in different industries/communities",
    when_to_use: "When building your network strategy, deciding which events to attend, making introductions",
    tags: ["connector", "bridge", "strategy", "social-capital", "introductions"],
  },
  {
    source: "Reid Hoffman, The Start-up of You",
    title: "The Alliance Framework",
    core_principle: "Treat professional relationships as alliances — mutually beneficial, time-bound commitments to help each other.",
    full_text: "Hoffman suggests framing key relationships as 'tours of duty' or alliances. Rather than vague networking, explicitly discuss how you can help each other over a specific period. This creates clarity and mutual accountability. An alliance might be: 'I'll introduce you to 3 potential clients this quarter, and you help me learn about the AI industry.' This framing makes networking feel less awkward and more productive.",
    application_steps: "1. Identify 3-5 people for potential alliances\n2. Propose a specific mutual value exchange\n3. Set a timeframe (3-6 months)\n4. Check in regularly on progress\n5. Renew or evolve the alliance as needed",
    when_to_use: "When deepening key professional relationships, seeking mentorship, building strategic partnerships",
    tags: ["alliance", "strategic", "professional", "mutual-value"],
  },
  {
    source: "Dale Carnegie, How to Win Friends and Influence People",
    title: "Remember and Use Names",
    core_principle: "A person's name is, to that person, the sweetest sound in any language. Remembering and using it shows respect and attention.",
    full_text: "Carnegie's timeless principle is deceptively simple: remember people's names and use them in conversation. This signals that you see them as an individual, not just another face. Modern neuroscience confirms this — hearing our name activates unique brain patterns associated with self-identity. Practically, this means making a conscious effort to learn, remember, and use names. Techniques include repetition, association, and noting the name immediately after meeting someone.",
    application_steps: "1. When introduced, repeat the name: 'Nice to meet you, Anna'\n2. Use the name 2-3 times in the first conversation\n3. Create a mental association (Anna = artist)\n4. Record the name and context immediately after\n5. Use the name when following up",
    when_to_use: "Every time you meet someone new, and in subsequent conversations",
    tags: ["names", "first-meeting", "memory", "conversation", "basics"],
  },
  {
    source: "Dale Carnegie, How to Win Friends and Influence People",
    title: "Be Genuinely Interested in Others",
    core_principle: "You can make more friends in two months by being interested in others than in two years by trying to get others interested in you.",
    full_text: "The deepest human need in social interaction is to feel important and appreciated. Carnegie's key insight is that the best networkers are those who are genuinely curious about others — their work, passions, challenges. Instead of trying to impress, focus on learning. Ask thoughtful questions. Listen actively. Follow up on details they mentioned. This authentic interest is rare and magnetic.",
    application_steps: "1. Prepare 2-3 thoughtful questions before meetings\n2. Practice active listening — don't plan your response while they talk\n3. Ask follow-up questions based on what they share\n4. Remember details and reference them later\n5. Show genuine enthusiasm for their achievements",
    when_to_use: "In every conversation, especially first meetings and when deepening relationships",
    tags: ["curiosity", "listening", "conversation", "authenticity", "basics"],
  },
  {
    source: "Robert Cialdini, Influence",
    title: "The Reciprocity Principle",
    core_principle: "People feel obligated to return favors. By giving first, you create a natural desire in others to reciprocate.",
    full_text: "Cialdini's research demonstrated that reciprocity is one of the most powerful social forces. When someone does something for us, we feel a deep psychological urge to return the favor. In networking, this means that leading with generosity creates a virtuous cycle. But this must be authentic — people can detect manipulation. The key is to give without expectation, knowing that over time, the network effect of generosity compounds enormously.",
    application_steps: "1. Always give first — never start by asking\n2. Make your giving specific and personal\n3. Don't keep score — but trust the process\n4. Accept help gracefully when offered (this completes the cycle)\n5. Be patient — reciprocity works over months, not minutes",
    when_to_use: "As a foundational networking principle in all interactions",
    tags: ["reciprocity", "giving", "psychology", "influence", "mindset"],
  },
  {
    source: "Robert Zajonc, Mere Exposure Effect",
    title: "The Power of Repeated Contact",
    core_principle: "We develop preference for things merely because we're familiar with them. Regular, low-pressure contact builds warmth.",
    full_text: "Zajonc's research showed that mere repeated exposure to something increases our liking of it — even without direct interaction. Applied to networking, this means that regular, light touches (liking posts, brief messages, attending the same events) build familiarity and warmth over time. You don't need deep conversations every time — sometimes just being visible is enough. This is why consistent, light networking beats sporadic intense efforts.",
    application_steps: "1. React to contacts' social media posts regularly\n2. Send brief 'thinking of you' messages monthly\n3. Attend recurring events where you'll see the same people\n4. Share content that keeps you visible in your network\n5. Don't force deep interactions — light touches count",
    when_to_use: "For maintaining and warming relationships with medium-tier contacts (Dunbar 15-150)",
    tags: ["consistency", "digital", "social-media", "light-touch", "warming"],
  },
  {
    source: "Brené Brown, Daring Greatly",
    title: "Vulnerability as Connection Catalyst",
    core_principle: "Sharing appropriate vulnerability creates deeper, more authentic connections than always appearing perfect.",
    full_text: "Brown's research shows that vulnerability — sharing struggles, uncertainties, and imperfections — is the birthplace of connection. In networking, this is counterintuitive: we think we need to appear successful and polished. But authentically sharing a challenge or admitting what you don't know makes others feel safe to do the same. This creates genuine bonds. The key word is 'appropriate' — vulnerability should be calibrated to the relationship level.",
    application_steps: "1. Share a professional challenge you're working through\n2. Ask for advice on something you're unsure about\n3. Admit when you don't know something\n4. Share lessons from failures, not just successes\n5. Calibrate depth to the relationship — don't overshare early",
    when_to_use: "When deepening relationships beyond surface level, when conversations feel stuck at small talk",
    tags: ["vulnerability", "authenticity", "depth", "conversation", "trust"],
  },
  {
    source: "Keith Ferrazzi, Never Eat Alone",
    title: "The Networking Action Plan",
    core_principle: "Networking without a plan is just socializing. Set specific relationship goals and track progress systematically.",
    full_text: "Ferrazzi emphasizes that effective networking requires intentionality. This means having a clear list of people you want to know, industries you want to connect with, and specific goals for each relationship. Without a plan, networking becomes random and inefficient. Review your network monthly: who should you reach out to? Who have you neglected? What introductions should you make? This systematic approach ensures consistent growth.",
    application_steps: "1. List 10-20 people you'd like to know or deepen relationships with\n2. For each, define what value you can offer\n3. Set weekly networking goals (e.g., 3 outreach messages)\n4. Review your CRM weekly — who needs attention?\n5. Monthly: assess progress and adjust targets",
    when_to_use: "Monthly planning, weekly review, when feeling directionless in networking",
    tags: ["planning", "strategy", "goals", "system", "tracking"],
  },
  {
    source: "Adam Grant, Give and Take",
    title: "Giver vs Taker vs Matcher",
    core_principle: "Givers who set boundaries are the most successful networkers. Pure takers and doormats both fail long-term.",
    full_text: "Grant identified three networking styles: Givers (help without expecting return), Takers (seek to extract value), and Matchers (tit-for-tat). Surprisingly, both the most and least successful people are givers. The difference? Successful givers set boundaries and are strategic about their generosity. They help enthusiastically but protect their time and energy. They're also good at identifying takers and limiting exposure to them.",
    application_steps: "1. Default to giving — but notice patterns\n2. If someone only takes, reduce investment\n3. Set time boundaries on helping (the 5-minute favor)\n4. Focus giving on other givers and matchers\n5. Don't feel guilty about protecting your energy",
    when_to_use: "When feeling drained by networking, when deciding how much to invest in a relationship",
    tags: ["giving", "boundaries", "energy", "strategy", "self-care"],
  },
  {
    source: "Susan Cain, Quiet",
    title: "The Introvert's Networking Advantage",
    core_principle: "Introverts excel at deep, one-on-one conversations — the foundation of meaningful networking.",
    full_text: "Cain's work reframes introversion as a networking strength. While extroverts may collect more contacts, introverts naturally build deeper connections. Introverts tend to listen more, ask better questions, and remember details — all crucial for lasting relationships. The key is to play to these strengths: prefer small gatherings, schedule one-on-one meetings, use written follow-ups (which introverts often excel at), and build in recovery time.",
    application_steps: "1. Choose small events over large conferences\n2. Set a goal of 2-3 deep conversations, not 20 business cards\n3. Use written communication (email, messages) for follow-up\n4. Schedule networking with recovery time after\n5. Leverage listening skills — people love being heard",
    when_to_use: "For introverted users who feel overwhelmed by traditional networking advice",
    tags: ["introvert", "depth", "conversation", "one-on-one", "energy-management"],
  },
];

async function seed() {
  console.log("Seeding methodologies...");

  const existing = await prisma.methodology.count();
  if (existing > 0) {
    console.log(`Already ${existing} methodologies in database. Skipping seed.`);
    return;
  }

  for (const m of METHODOLOGIES) {
    await prisma.methodology.create({ data: m });
  }

  console.log(`Seeded ${METHODOLOGIES.length} methodologies.`);
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
