// Shared case-insensitive exercise name -> id resolver. Used by program
// generation and set logging so both land on the same row instead of
// silently creating near-duplicate "custom" exercises.
export async function resolveExerciseId(sql, userId, name) {
  const [found] = await sql`select id, category, equipment, is_bodyweight from exercises where lower(name) = lower(${name})`;
  if (found) return found;
  const [created] = await sql`
    insert into exercises (name, custom, created_by) values (${name}, true, ${userId})
    on conflict (name) do update set name = excluded.name
    returning id, category, equipment, is_bodyweight
  `;
  return created;
}
