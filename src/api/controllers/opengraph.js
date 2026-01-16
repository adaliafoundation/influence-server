const appConfig = require('config');
const KoaRouter = require('@koa/router');
// const BookService = require('@common/services/Book');
// const StoryService = require('@common/services/Story');
// const StorySessionService = require('@common/services/Story/Session');

// NOTE: this endpoint is no longer used, but is maintained as redirect for old tweet links
const getDefault = async function (ctx) {
  const { params: { recruiter } } = ctx;
  ctx.redirect(
    `${appConfig.get('App.clientUrl')}/play${recruiter ? `?r=${recruiter}` : ''}`
  );
};

// TODO: restore all these routes when books/stories ready again

// // NOTE: this endpoint is no longer used, but is maintained as redirect for old tweet links
// const getCrewAssignment = async function (ctx) {
//   const { params: { recruiter, session: _id } } = ctx;
//   ctx.redirect(
//     `${process.env.CLIENT_URL}/play/crew-assignment/${_id}${recruiter ? `?r=${recruiter}` : ''}`
//   );
// };

// const getCrewAssignmentBookData = async function (ctx) {
//   const { params: { book: id } } = ctx;
//   try {
//     const book = await BookService.findOneValid({ id });
//     if (!book) throw new Error('Invalid Book');

//     ctx.type = 'application/json';
//     ctx.body = {
//       title: book.title,
//       image: book.icon
//     };
//   } catch (error) {
//     ctx.status = 400;
//     ctx.body = '';
//   }
//   return ctx;
// };

// const getCrewAssignmentData = async function (ctx) {
//   const { params: { session: _id } } = ctx;
//   try {
//     const session = await StorySessionService.findOne({ _id });
//     if (!session) throw new Error('Invalid Session');
//     const story = await StoryService.findOneValid(session.story);
//     if (!story) throw new Error('Invalid Story');

//     ctx.type = 'application/json';
//     ctx.body = {
//       title: story.title,
//       image: story.image
//     };
//   } catch (error) {
//     ctx.status = 400;
//     ctx.body = '';
//   }
//   return ctx;
// };

const router = new KoaRouter({ prefix: '/og' })
  .get('/:recruiter?', getDefault);
//   .get('/crew-assignment/:session/:recruiter?', getCrewAssignment)
//   .get('/data/crew-assignments/:book', getCrewAssignmentBookData)
//   .get('/data/crew-assignment/:session', getCrewAssignmentData);

module.exports = router;
