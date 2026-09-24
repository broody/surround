//! `surround-capacity PIE [LIMIT]`: runs the privacy bootloader on a virtual-OS PIE, as
//! PROOF1 and the large path do, and reports the resulting Stwo trace: instruction
//! counts per opcode, and every component's log size. Components above LIMIT (default
//! 20, PROOF1's trace size) are marked; any such component makes PROOF1 fail with
//! "Not enough twiddles!". Prints JSON; generates the trace, never a proof.
use std::rc::Rc;
use std::sync::Arc;
use std::time::Instant;

use anyhow::{anyhow, Context, Result};
use cairo_program_runner_lib::types::{HashFunc, PrivacySimpleBootloaderInput, SimpleBootloaderInput};
use cairo_program_runner_lib::{cairo_run_program, ProgramInput, Task, TaskSpec};
use cairo_vm::vm::runners::cairo_pie::CairoPie;
use privacy_circuit_verify::get_privacy_bootloader_program;
use privacy_prove::consts::{CAIRO_PROVER_PARAMS, CAIRO_RUN_CONFIG};
use serde_json::{json, Map, Value};
use stwo_cairo_adapter::adapter::adapt;
use stwo_cairo_prover::witness::cairo::create_cairo_claim_generator;

// Collects every `log_size` (or `big_log_sizes`) in the serialized claim, keyed by component.
fn log_sizes(value: &Value, path: &str, out: &mut Map<String, Value>) {
    if let Value::Object(map) = value {
        for (key, inner) in map {
            let name = if path.is_empty() { key.clone() } else { format!("{path}.{key}") };
            match (key.as_str(), inner) {
                ("log_size", Value::Number(n)) => {
                    out.insert(path.to_string(), json!(n));
                }
                ("big_log_sizes", Value::Array(xs)) => {
                    out.insert(path.to_string(), json!(xs.iter().filter_map(Value::as_u64).max()));
                }
                _ => log_sizes(inner, &name, out),
            }
        }
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let pie_path = args.get(1).context("usage: surround-capacity PIE [LIMIT]")?;
    let limit: u64 = args.get(2).map(|s| s.parse()).transpose()?.unwrap_or(20);
    let pie = CairoPie::read_zip_file(std::path::Path::new(pie_path)).context("reading the PIE")?;
    let pie_steps = pie.execution_resources.n_steps;

    let start = Instant::now();
    let preimage = tempfile::NamedTempFile::new()?;
    let input = PrivacySimpleBootloaderInput {
        simple_bootloader_input: SimpleBootloaderInput {
            fact_topologies_path: None,
            single_page: true,
            tasks: vec![TaskSpec { task: Rc::new(Task::Pie(pie)), program_hash_function: HashFunc::Blake }],
        },
        output_preimage_dump_path: preimage.path().to_path_buf(),
    };
    let program = get_privacy_bootloader_program().map_err(|e| anyhow!("{e}"))?;
    let runner = cairo_run_program(&program, Some(ProgramInput::Value(Box::new(input))), CAIRO_RUN_CONFIG, None)
        .map_err(|e| anyhow!("bootloader: {e}"))?;
    let prover_input = adapt(&runner).map_err(|e| anyhow!("adapter: {e}"))?;
    let boot_seconds = start.elapsed().as_secs_f64();

    let opcodes: Map<String, Value> = prover_input
        .state_transitions
        .casm_states_by_opcode
        .counts()
        .into_iter()
        .filter(|(_, n)| *n > 0)
        .map(|(name, n)| (name, json!(n)))
        .collect();
    let total: usize = opcodes.values().filter_map(Value::as_u64).map(|n| n as usize).sum();

    let start = Instant::now();
    let generator = create_cairo_claim_generator(prover_input, Arc::new(CAIRO_PROVER_PARAMS.preprocessed_trace.to_preprocessed_trace()));
    let (trace, claim, _) = generator.write_trace(CAIRO_PROVER_PARAMS.opt_n_id_to_big_components);
    let trace_seconds = start.elapsed().as_secs_f64();
    drop(trace);

    let mut components = Map::new();
    log_sizes(&serde_json::to_value(&claim)?, "", &mut components);
    let over: Vec<String> = components
        .iter()
        .filter(|(_, v)| v.as_u64().is_some_and(|n| n > limit))
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "pie_steps": pie_steps, "trace_instructions": total, "limit": limit, "fits": over.is_empty(), "over_limit": over,
            "opcodes": opcodes, "components": components,
            "seconds": {"bootloader": boot_seconds, "trace": trace_seconds},
        }))?
    );
    Ok(())
}
