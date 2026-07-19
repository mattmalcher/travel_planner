/* Load ajv + the itinerary schema for client-side validation of AI edits.
   Exposes window.hValidate(doc)->{ok,errors} and window.hSchemaText (raw schema).
   Injected verbatim into the built page as a separate module script (not
   bundled) so the esm.sh imports stay dynamic and the app works without them. */
try{
  const [{default:Ajv},{default:addFormats}]=await Promise.all([
    import('https://esm.sh/ajv@8?bundle'),
    import('https://esm.sh/ajv-formats@3?bundle')
  ]);
  const schema=await (await fetch('holiday_itinerary_schema.json')).json();
  window.hSchemaText=JSON.stringify(schema);
  window.hSchemaVersion=schema.version;
  if(schema.version&&window.H_SCHEMA_VERSION&&schema.version!==window.H_SCHEMA_VERSION)
    console.warn(`This build expects schema ${window.H_SCHEMA_VERSION} but the deployed holiday_itinerary_schema.json is ${schema.version}. Rebuild so the page and schema deploy together.`);
  const ajv=new Ajv({allErrors:true,strict:false});
  addFormats(ajv);
  const validate=ajv.compile(schema);
  window.hValidate=function(doc){
    const ok=validate(doc);
    return{ok,errors:ok?[]:(validate.errors||[]).map(e=>({path:e.instancePath||'/',message:e.message,params:e.params}))};
  };
  const segSchema={"$schema":"http://json-schema.org/draft-07/schema#","definitions":schema.definitions,"oneOf":[{"$ref":"#/definitions/TransportSegment"},{"$ref":"#/definitions/AccommodationSegment"},{"$ref":"#/definitions/EventSegment"}]};
  const validateSeg=ajv.compile(segSchema);
  window.hValidateSegment=function(seg){const ok=validateSeg(seg);return{ok,errors:ok?[]:(validateSeg.errors||[]).map(e=>({path:e.instancePath||'/',message:e.message,params:e.params}))};};
  const tripSchema={"$schema":"http://json-schema.org/draft-07/schema#","definitions":schema.definitions,...schema.properties.trip};
  const validateTrip=ajv.compile(tripSchema);
  window.hValidateTrip=function(trip){const ok=validateTrip(trip);return{ok,errors:ok?[]:(validateTrip.errors||[]).map(e=>({path:e.instancePath||'/',message:e.message,params:e.params}))};};
  const listSchema={"$schema":"http://json-schema.org/draft-07/schema#","definitions":schema.definitions,"$ref":"#/definitions/List"};
  const validateList=ajv.compile(listSchema);
  window.hValidateList=function(list){const ok=validateList(list);return{ok,errors:ok?[]:(validateList.errors||[]).map(e=>({path:e.instancePath||'/',message:e.message,params:e.params}))};};
}catch(e){console.error('AI validation unavailable (ajv/schema failed to load):',e);}
