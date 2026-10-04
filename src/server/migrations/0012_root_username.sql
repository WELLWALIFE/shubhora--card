-- Everyone is shown by username now, never by SH code. The company's own top ID gets a name too, so a person whose
-- introducer is the company sees "Shubhora" rather than a code.
update members set username = 'Shubhora' where parent_id is null and username is null
  and not exists (select 1 from members where lower(username) = 'shubhora');
