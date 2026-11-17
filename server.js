require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Подключение к облачной БД (Render) или локальной PostgreSQL
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
      }
);

// 1. Инициализация таблиц и автозаполнение стартовыми данными
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        grade VARCHAR(20),
        email VARCHAR(150) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        quiz_score INTEGER DEFAULT 0,
        user_xp INTEGER DEFAULT 0,
        user_fish INTEGER DEFAULT 3,
        mascot_hunger INTEGER DEFAULT 50,
        last_feed_date DATE DEFAULT CURRENT_DATE,
        done_tasks JSONB DEFAULT '[]'::jsonb,
        quiz_answers JSONB DEFAULT '[]'::jsonb,
        recommended_universities JSONB DEFAULT '[]'::jsonb,
        selected_universities JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS user_fish INTEGER DEFAULT 3;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS mascot_hunger INTEGER DEFAULT 50;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_feed_date DATE DEFAULT CURRENT_DATE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS recommended_universities JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_universities JSONB DEFAULT '[]'::jsonb;

      CREATE TABLE IF NOT EXISTS universities (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        tier VARCHAR(50) NOT NULL,
        min_score INTEGER NOT NULL,
        city VARCHAR(100) NOT NULL,
        tuition_fee INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS roadmap_tasks (
        id VARCHAR(50) PRIMARY KEY,
        tier_number INTEGER NOT NULL,
        tier_title VARCHAR(150) NOT NULL,
        task_index INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        xp INTEGER NOT NULL DEFAULT 50,
        is_daily BOOLEAN DEFAULT FALSE
      );
    `);

    // Автозаполнение университетов, если таблица пустая
    const uniCount = await pool.query('SELECT COUNT(*) FROM universities');
    if (parseInt(uniCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO universities (name, category, tier, min_score, city, tuition_fee) VALUES
        ('МГУ им. М.В. Ломоносова', 'Классический', 'Топ-университет', 285, 'Москва', 450000),
        ('МФТИ (Физтех)', 'ИТ и Точные науки', 'Топ-университет', 292, 'Долгопрудный', 420000),
        ('Университет ИТМО', 'ИТ и Точные науки', 'Топ-университет', 280, 'Санкт-Петербург', 390000),
        ('Первый МГМУ им. И.М. Сеченова', 'Медицинский', 'Топ-университет', 275, 'Москва', 480000),
        ('НИУ ВШЭ', 'Гуманитарный', 'Топ-университет', 282, 'Москва', 440000),
        ('СВФУ им. М.К. Аммосова', 'Классический', 'Ведущий федеральный', 195, 'Якутск', 160000),
        ('УрФУ им. Б.Н. Ельцина', 'ИТ и Точные науки', 'Ведущий федеральный', 220, 'Екатеринбург', 190000),
        ('КФУ (Казанский федеральный)', 'Гуманитарный', 'Ведущий федеральный', 225, 'Казань', 185000),
        ('СибГМУ', 'Медицинский', 'Региональный опорный', 210, 'Томск', 175000),
        ('Колледж информационных технологий', 'ИТ и Точные науки', 'Запасной/Колледж', 140, 'Москва', 110000),
        ('Медицинский колледж №1', 'Медицинский', 'Запасной/Колледж', 135, 'Санкт-Петербург', 95000),
        ('Гуманитарно-педагогический колледж', 'Гуманитарный', 'Запасной/Колледж', 130, 'Казань', 85000);
      `);
      console.log('🎓 Стартовый список университетов загружен.');
    }

    // Автозаполнение заданий дорожной карты, если таблица пустая
    const taskCount = await pool.query('SELECT COUNT(*) FROM roadmap_tasks');
    if (parseInt(taskCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO roadmap_tasks (id, tier_number, tier_title, task_index, title, xp, is_daily) VALUES
        ('d1', 0, 'Ежедневные', 1, 'Решить 5 тестовых заданий по профильному предмету', 50, true),
        ('d2', 0, 'Ежедневные', 2, 'Выучить 10 новых терминов или иностранных слов', 40, true),
        ('d3', 0, 'Ежедневные', 3, 'Изучить один факультет из списка целевых вузов', 60, true),
        ('t1_1', 1, 'Этап 1: Самоопределение и выбор стратегии', 1, 'Пройти профориентационный тест на 30 вопросов', 100, false),
        ('t1_2', 1, 'Этап 1: Самоопределение и выбор стратегии', 2, 'Выбрать 3–4 предмета для сдачи на ЕГЭ/ОГЭ', 120, false),
        ('t1_3', 1, 'Этап 1: Самоопределение и выбор стратегии', 3, 'Составить список из 5 вузов: топ, база и запасной', 150, false),
        ('t2_1', 2, 'Этап 2: Подготовка и портфолио', 1, 'Написать пробный вариант экзамена на время', 180, false),
        ('t2_2', 2, 'Этап 2: Подготовка и портфолио', 2, 'Зарегистрироваться на перечневую олимпиаду', 200, false),
        ('t2_3', 2, 'Этап 2: Подготовка и портфолио', 3, 'Оформить книжку волонтёра или сдать нормативы ГТО', 150, false),
        ('t3_1', 3, 'Этап 3: Подача документов и поступление', 1, 'Проверить даты дней открытых дверей и дедлайны приёма', 150, false),
        ('t3_2', 3, 'Этап 3: Подача документов и поступление', 2, 'Подготовить пакет документов (паспорт, аттестат, СНИЛС)', 200, false),
        ('t3_3', 3, 'Этап 3: Подача документов и поступление', 3, 'Подать заявления через Госуслуги и отследить конкурсные списки', 300, false);
      `);
      console.log('🗺️ Стартовые задания дорожной карты загружены.');
    }

    console.log('✅ База PostgreSQL подключена, таблицы готовы.');
  } catch (err) {
    console.error('❌ ОШИБКА ИНИЦИАЛИЗАЦИИ БАЗЫ:', err.message);
  }
}
// 2. Маршруты API

// Регистрация
app.post('/api/register', async (req, res) => {
  const { name, grade, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, grade, email, password) VALUES ($1, $2, $3, $4) RETURNING id, name`,
      [name, grade, email, hashedPassword]
    );
    res.status(201).json({ userId: result.rows[0].id, name: result.rows[0].name });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Эта почта уже зарегистрирована' });
    res.status(500).json({ error: 'Ошибка БД: ' + err.message });
  }
});

// Вход с проверкой сброса сытости маскота на новый день
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Неверный пароль' });

    const today = new Date().toLocaleDateString('sv-SE');
    const lastFeed = user.last_feed_date ? new Date(user.last_feed_date).toLocaleDateString('sv-SE') : '';
    let currentHunger = user.mascot_hunger ?? 50;

    if (today !== lastFeed) {
      currentHunger = 20;
      await pool.query(
        'UPDATE users SET mascot_hunger = $1, last_feed_date = CURRENT_DATE WHERE id = $2',
        [currentHunger, user.id]
      );
    }

    res.json({
      userId: user.id,
      name: user.name,
      quizScore: user.quiz_score,
      userXP: user.user_xp,
      userFish: user.user_fish ?? 3,
      mascotHunger: currentHunger,
      doneTasks: user.done_tasks,
      quizAnswers: user.quiz_answers,
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка БД: ' + err.message });
  }
});

// Сохранение результатов квиза
app.post('/api/save-quiz', async (req, res) => {
  const { userId, score, xp, answers } = req.body;
  try {
    await pool.query(
      'UPDATE users SET quiz_score = $1, user_xp = $2, quiz_answers = $3::jsonb WHERE id = $4',
      [score, xp, JSON.stringify(answers || []), userId]
    );
    res.json({ message: 'Результаты сохранены' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Сохранение общего прогресса (XP, рыба, сытость + дата кормления, задания)
app.post('/api/save-progress', async (req, res) => {
  const { userId, xp, fish, hunger, doneTasks } = req.body;
  try {
    await pool.query(
      `UPDATE users 
       SET user_xp = $1, 
           user_fish = COALESCE($2, user_fish), 
           mascot_hunger = COALESCE($3, mascot_hunger),
           last_feed_date = CASE WHEN $3 IS NOT NULL THEN CURRENT_DATE ELSE last_feed_date END,
           done_tasks = $4::jsonb 
       WHERE id = $5`,
      [xp, fish ?? null, hunger ?? null, JSON.stringify(doneTasks || []), userId]
    );
    res.json({ message: 'Прогресс успешно сохранен в БД' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получение заданий дорожной карты
app.get('/api/roadmap-tasks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM roadmap_tasks ORDER BY tier_number ASC, task_index ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получение полного списка университетов
app.get('/api/universities', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM universities ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получение сохраненных университетов пользователя
app.get('/api/user-universities/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT recommended_universities, selected_universities FROM users WHERE id = $1',
      [req.params.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({
      recommended: result.rows[0].recommended_universities || [],
      selected: result.rows[0].selected_universities || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Сохранение рекомендованных и выбранных вручную университетов в БД
app.post('/api/save-universities', async (req, res) => {
  const { userId, recommended, selected } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });

  try {
    await pool.query(
      `UPDATE users 
       SET recommended_universities = COALESCE($1::jsonb, recommended_universities),
           selected_universities = COALESCE($2::jsonb, selected_universities)
       WHERE id = $3`,
      [
        recommended !== undefined ? JSON.stringify(recommended) : null,
        selected !== undefined ? JSON.stringify(selected) : null,
        userId
      ]
    );
    res.json({ message: 'Университеты сохранены в БД' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Алгоритм подбора университетов по ответам теста
app.post('/api/recommend-universities', async (req, res) => {
  const { answers } = req.body;
  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'Ответы не переданы' });
  }

  const areaAnswer = answers[10] !== undefined ? answers[10] : 1;
  let targetCategory = 'Классический';
  if (areaAnswer === 1) targetCategory = 'ИТ и Точные науки';
  else if (areaAnswer === 2) targetCategory = 'Медицинский';
  else if (areaAnswer === 0) targetCategory = 'Гуманитарный';

  const budgetAnswer = answers[6] !== undefined ? answers[6] : 0;
  const maxFee = budgetAnswer === 0 ? 0 : 99999999;

  try {
    const result = await pool.query(
      `
      WITH scored_universities AS (
        SELECT *,
          CASE WHEN category = $1 THEN 2 ELSE 1 END as match_priority
        FROM universities
        WHERE ($2 = 0 AND tuition_fee = 0) OR ($2 > 0)
      )
      (
        SELECT *, 'Оптимистичный (Топ)' AS strategy_type 
        FROM scored_universities 
        WHERE tier = 'Топ-университет' 
        ORDER BY match_priority DESC, min_score DESC LIMIT 2
      )
      UNION ALL
      (
        SELECT *, 'Реалистичный' AS strategy_type 
        FROM scored_universities 
        WHERE tier IN ('Ведущий федеральный', 'Региональный опорный') 
        ORDER BY match_priority DESC, min_score ASC LIMIT 2
      )
      UNION ALL
      (
        SELECT *, 'Запасной' AS strategy_type 
        FROM scored_universities 
        WHERE tier = 'Запасной/Колледж' 
        ORDER BY min_score ASC LIMIT 1
      )
      `,
      [targetCategory, maxFee]
    );

    if (result.rows.length < 5) {
      const fallback = await pool.query(`
        (SELECT *, 'Оптимистичный (Топ)' AS strategy_type FROM universities WHERE tier = 'Топ-университет' LIMIT 2)
        UNION ALL
        (SELECT *, 'Реалистичный' AS strategy_type FROM universities WHERE tier = 'Ведущий федеральный' LIMIT 2)
        UNION ALL
        (SELECT *, 'Запасной' AS strategy_type FROM universities WHERE tier = 'Запасной/Колледж' LIMIT 1)
      `);
      return res.json(fallback.rows);
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка алгоритма подбора:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. Запуск сервера после готовности БД
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
  });
});
