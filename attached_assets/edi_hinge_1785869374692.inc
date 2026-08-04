<?php

class Sirius_Smf_Report_Edi_Hinge extends Sirius_Trust_Provider_Edi_Report_Generator {
  public $type = 'sirius-smf-edi-hinge';

  public function benefit_nid() { return $this->benefit_nid_from_id('HINGEPT'); }

  public function info($result = array()) {
    $result = array(
      'name' => t('EDI - Hinge'),
      'description' => '',
      'access' => 'sirius trust staff',
      'module' => 'sirius_smf',
      'file' => 'reports/edi_hinge.inc',
      'row_encoding' => 'json',
      'edi_tiers' => array('blended'),
      'edi_output_format' => 'csv',
    );

    return parent::info($result);
  }

  public function edi_premium_tier($context) {
    if (!($this->is_subscriber($context))) { return NULL; }
    return 'blended';
  }

  public function fields() {
    $field_names = array(
      'subscriber_id',
      'first_name',
      'last_name',
      'dob',
      'relationship',
      'sex',
      'address1',
      'address2',
      'city',
      'state',
      'zip',
      'email',
      'start_date',
      'term_date',
      'language',
    );

    $fields = array();
    foreach ($field_names as $field_name) { $fields[$field_name] = $field_name; }
    return $fields;
  }

  public function batch($workers, $values, &$batch_context) {
    $rows = array();
    foreach ($workers as $worker_nid => $worker) {
      $wb_nid = $worker['wb_nid'];
      $context = $this->context($worker, $asof_date, $values['parameters']);
      if (!$context['worker_node']) { continue; }

      $row = array();
      $row['subscriber_id'] = $context['worker_node']->field_sirius_id['und'][0]['value'];
      $row['first_name'] = $context['worker_node']->field_sirius_name['und'][0]['given'];
      $row['last_name']  = $context['worker_node']->field_sirius_name['und'][0]['family'];
      $row['dob'] = $this->dob($context, 'worker_node');

      $sex = $context['worker_node']->field_sirius_gender['und'][0]['tid'];
      if ($sex) {
        $sex_term = taxonomy_term_load($sex);
        $sex = $sex_term->field_sirius_name_short['und'][0]['value'];
        if (!in_array($sex, array('M', 'F'))) {
          $sex = 'U';
        }
      }
      $row['sex'] = $sex;

      if ($context['relationship_node']) {
        $reltype_tid = $context['relationship_node']->field_sirius_contact_reltype['und'][0]['tid'];
        $reltype_term = taxonomy_term_load($reltype_tid);
        $reltype_id = $reltype_term->field_sirius_id['und'][0]['value'];

        if (in_array($reltype_id, array('DB', 'ES', 'SP'))) {
          $relationship = 'Spouse';
        } else if (in_array($reltype_id, array('G', 'C', 'AC', 'H', 'SC'))) {
          $relationship = 'Child';
        } else if (in_array($reltype_id, array('QMSCO'))) {
          $relationship = 'Q';
        } else {
          $relationship = 'Other';
        }
      } else {
        $relationship = 'EE';
      }
      $row['relationship'] = $relationship;

      $this->is_qmsco($context);

      $row['address1'] = $this->hinge_column($context, 'thoroughfare');
      $row['address2'] = $this->hinge_column($context, 'premise');
      $row['city'] = $this->hinge_column($context, 'locality');
      $row['state'] = $this->hinge_column($context, 'administrative_area');
      $row['zip'] = $this->hinge_column($context, 'zip');
      $row['email'] = $context['worker_node']->field_sirius_email['und'][0]['value'];
      $row['start_date'] = $this->coverage_start_date($context);
      $row['term_date'] = $this->coverage_end_date($context);
      $row['language'] = $this->lang($context);

      $row = $this->edi_row($row, $context);

      $rows[$context['pk']] = $row;
    }

    return array('is_multiple' => TRUE, 'rows' => $rows);
  }

  public function hinge_column($context, $column) {
    // First try to fetch the data directly from the worker.
    if ($column == 'zip')       { $result = $this->zip($context, 'worker_node'); }
    elseif ($column == 'phone') { $result = $this->phone($context, 'worker_node'); }
    else                        { $result = $context['worker_node']->field_sirius_address['und'][0][$column]; }
    if ($result) { return $result; }

    // If the worker is QMSCO, we're done now.
    if ($this->is_qmsco($context)) { return ''; }

    // Otherwise, copy the data from the subscriber.
    if ($column == 'zip')       { $result = $this->zip($context, 'subscriber_node'); }
    elseif ($column == 'phone') { $result = $this->phone($context, 'subscriber_node'); }
    else                        { $result = $context['subscriber_node']->field_sirius_address['und'][0][$column]; }
    return $result;
  }

}
