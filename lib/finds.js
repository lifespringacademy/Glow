// The Family Hunt photo finds. Edit this list to change the hunt for a new season.
// id: never change an id once families have started finding it.
// hint: what the AI looks for in the photo.
export const FINDS = [
  { id: 'train',    name: 'A lit-up train',          pts: 15, hint: 'a train shape or model train outlined or covered in lights' },
  { id: 'music',    name: 'A house synced to music', pts: 15, hint: 'a house light show with a sign showing an FM radio station, or lights clearly part of a music show' },
  { id: 'roof',     name: 'Santa on a roof',         pts: 20, hint: 'a Santa figure, inflatable or lit, on a rooftop' },
  { id: 'blue',     name: 'An all-blue display',     pts: 15, hint: 'a house or display lit only in blue lights' },
  { id: 'tunnel',   name: 'A tunnel of lights',      pts: 20, hint: 'an arch or tunnel made of lights that people walk or drive through' },
  { id: 'nativity', name: 'A nativity scene',        pts: 10, hint: 'a manger scene with figures such as Mary, Joseph and baby Jesus' },
  { id: 'reindeer', name: 'A team of lit reindeer',  pts: 15, hint: 'two or more lit reindeer figures together' },
  { id: 'megatree', name: 'A tree made of lights',   pts: 15, hint: "a cone-shaped 'mega tree' made from strands of lights, not a regular decorated tree" },
  { id: 'canes',    name: 'A row of candy canes',    pts: 10, hint: 'three or more lit candy canes lining a walk or driveway' },
  { id: 'snowman',  name: 'A giant snowman',         pts: 10, hint: 'a large inflatable or lit snowman' },
  { id: 'wreath',   name: 'A giant lit wreath',      pts: 10, hint: 'a large wreath decorated with lights, bigger than a front door' },
  { id: 'star',     name: 'A lit star on top',       pts: 10, hint: 'a lit star on the top of a house, tree or tall pole' }
];

export const CHECKIN_POINTS = (d) => (d.spotlight ? 20 : 10 + (d.featured ? 5 : 0));
